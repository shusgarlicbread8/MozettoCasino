// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

interface IArenaAccountFactory {
    function syncOwner(address previousOwner, address newOwner) external;
}

/// @title ArenaAccount — per-owner gaming custody (USDC held here; vault may only enter allowed games)
/// @dev Owner is MetaMask/Coinbase EOA or ERC-1271 wallet. Platform has no withdraw/execute authority.
contract ArenaAccount is Initializable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant GAME_PERMISSION_TYPEHASH = keccak256(
        "GamePermission(address account,address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled)"
    );

    address public owner;
    address public pendingOwner;
    address public factory;

    struct GameAuth {
        address sessionSigner;
        address usdc;
        address vault;
        bytes32 gameTemplateId;
        uint32 leagueMask;
        uint256 lifetimeCommittedCap;
        uint256 lifetimeCommitted;
        uint256 maxTotalAtRisk;
        uint256 activeAtRisk;
        uint256 maxSingleBuyIn;
        uint64 validUntil;
        uint16 maxConcurrentGames;
        uint16 activeGames;
        bool ratedOnly;
        bool enabled;
    }

    GameAuth public gameAuth;
    uint256 public gameAuthNonce;
    mapping(bytes32 => uint256) public sessionExposure;
    mapping(bytes32 => address) public sessionVault;

    event Initialized(address indexed owner, address indexed factory);
    event GamePermissionAuthorized(
        address indexed sessionSigner,
        address indexed vault,
        bytes32 gameTemplateId,
        uint256 lifetimeCommittedCap,
        uint256 maxTotalAtRisk,
        uint256 maxSingleBuyIn,
        uint64 validUntil,
        uint16 maxConcurrentGames
    );
    event GamePermissionRevoked(address indexed sessionSigner);
    event PermissionNonceBumped(uint256 newNonce);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event BuyInPulled(bytes32 indexed sessionId, address indexed vault, uint256 amount);
    event ExposureReleased(bytes32 indexed sessionId, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error BadSignature();
    error BadNonce();
    error PermissionInactive();
    error PermissionExpired();
    error WrongVault();
    error TemplateNotAllowed();
    error LeagueNotAllowed();
    error RatedRequired();
    error BuyInTooHigh();
    error LifetimeCapExceeded();
    error AtRiskCapExceeded();
    error ConcurrentGamesExceeded();
    error InsufficientBalance();
    error UnknownSession();
    error SessionAlreadyOpen();
    error SessionNotOpen();
    error NoPendingOwner();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() EIP712("MozettoArenaAccount", "1") {
        _disableInitializers();
    }

    function initialize(address owner_, address factory_) external initializer {
        if (owner_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        owner = owner_;
        factory = factory_;
        emit Initialized(owner_, factory_);
    }

    /// @notice Authorize or revoke seamless-play GamePermission (owner-signed EIP-712).
    function setGamePermission(
        address sessionSigner,
        address usdc,
        address vault,
        bytes32 gameTemplateId,
        uint32 leagueMask,
        uint256 lifetimeCommittedCap,
        uint256 maxTotalAtRisk,
        uint256 maxSingleBuyIn,
        uint64 validUntil,
        uint16 maxConcurrentGames,
        bool ratedOnly,
        uint256 nonce,
        bool enabled,
        bytes calldata signature
    ) external nonReentrant {
        if (nonce != gameAuthNonce) revert BadNonce();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    GAME_PERMISSION_TYPEHASH,
                    address(this),
                    sessionSigner,
                    usdc,
                    vault,
                    gameTemplateId,
                    leagueMask,
                    lifetimeCommittedCap,
                    maxTotalAtRisk,
                    maxSingleBuyIn,
                    validUntil,
                    maxConcurrentGames,
                    ratedOnly,
                    nonce,
                    enabled
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) {
            revert BadSignature();
        }

        gameAuthNonce = nonce + 1;

        if (!enabled) {
            _clearPermissionAuthority();
            return;
        }

        if (sessionSigner == address(0) || usdc == address(0) || vault == address(0)) revert ZeroAddress();
        if (lifetimeCommittedCap == 0 || maxTotalAtRisk == 0 || maxSingleBuyIn == 0) revert ZeroAmount();
        if (maxConcurrentGames == 0) revert ZeroAmount();
        if (validUntil <= block.timestamp) revert PermissionExpired();
        if (gameTemplateId == bytes32(0)) revert TemplateNotAllowed();

        uint256 priorLifetime = gameAuth.lifetimeCommitted;
        uint256 priorAtRisk = gameAuth.activeAtRisk;
        uint16 priorGames = gameAuth.activeGames;

        gameAuth = GameAuth({
            sessionSigner: sessionSigner,
            usdc: usdc,
            vault: vault,
            gameTemplateId: gameTemplateId,
            leagueMask: leagueMask,
            lifetimeCommittedCap: lifetimeCommittedCap,
            lifetimeCommitted: priorLifetime,
            maxTotalAtRisk: maxTotalAtRisk,
            activeAtRisk: priorAtRisk,
            maxSingleBuyIn: maxSingleBuyIn,
            validUntil: validUntil,
            maxConcurrentGames: maxConcurrentGames,
            activeGames: priorGames,
            ratedOnly: ratedOnly,
            enabled: true
        });

        emit GamePermissionAuthorized(
            sessionSigner,
            vault,
            gameTemplateId,
            lifetimeCommittedCap,
            maxTotalAtRisk,
            maxSingleBuyIn,
            validUntil,
            maxConcurrentGames
        );
    }

    /// @notice Owner-only emergency revoke: clear GamePermission and bump nonce (no EIP-712 required).
    function revokeGamePermission() external nonReentrant {
        if (msg.sender != owner) revert Unauthorized();
        _clearPermissionAuthority();
        unchecked {
            gameAuthNonce += 1;
        }
        emit PermissionNonceBumped(gameAuthNonce);
    }

    /// @notice Alias for Plan 03 emergency nonce bump; clears authority and invalidates pending signatures.
    function emergencyInvalidatePermissions() external nonReentrant {
        if (msg.sender != owner) revert Unauthorized();
        _clearPermissionAuthority();
        unchecked {
            gameAuthNonce += 1;
        }
        emit PermissionNonceBumped(gameAuthNonce);
    }

    /// @notice Start two-step ownership transfer (Plan 03 secure path).
    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert Unauthorized();
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Complete ownership transfer; syncs ArenaAccountFactory owner mappings.
    function acceptOwnership() external nonReentrant {
        if (msg.sender != pendingOwner) revert NoPendingOwner();
        address previous = owner;
        address next = pendingOwner;
        pendingOwner = address(0);
        owner = next;
        IArenaAccountFactory(factory).syncOwner(previous, next);
        emit OwnershipTransferred(previous, next);
    }

    /// @notice Owner withdraws idle tokens from this account (platform cannot call).
    /// @dev Locked buy-ins already sit in the vault; this only moves remaining idle balance.
    function withdraw(address token, uint256 amount, address to) external nonReentrant {
        if (msg.sender != owner) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function _clearPermissionAuthority() internal {
        address prev = gameAuth.sessionSigner;
        // Keep exposure counters; clear authority fields.
        gameAuth.sessionSigner = address(0);
        gameAuth.usdc = address(0);
        gameAuth.vault = address(0);
        gameAuth.gameTemplateId = bytes32(0);
        gameAuth.leagueMask = 0;
        gameAuth.lifetimeCommittedCap = 0;
        gameAuth.maxTotalAtRisk = 0;
        gameAuth.maxSingleBuyIn = 0;
        gameAuth.validUntil = 0;
        gameAuth.maxConcurrentGames = 0;
        gameAuth.ratedOnly = false;
        gameAuth.enabled = false;
        emit GamePermissionRevoked(prev);
    }

    /// @notice Vault-only: pull buy-in USDC under an active GamePermission and reserve exposure.
    function lockBuyIn(bytes32 sessionId, uint256 buyIn, bytes32 gameTemplateId, uint32 leagueBit, bool rated)
        external
        nonReentrant
        returns (uint256)
    {
        if (buyIn == 0) revert ZeroAmount();
        GameAuth storage auth = gameAuth;
        if (!auth.enabled) revert PermissionInactive();
        if (block.timestamp > auth.validUntil) revert PermissionExpired();
        if (msg.sender != auth.vault) revert WrongVault();
        if (gameTemplateId != auth.gameTemplateId) revert TemplateNotAllowed();
        if (leagueBit == 0 || (auth.leagueMask & leagueBit) == 0) revert LeagueNotAllowed();
        if (auth.ratedOnly && !rated) revert RatedRequired();
        if (buyIn > auth.maxSingleBuyIn) revert BuyInTooHigh();
        if (auth.lifetimeCommitted + buyIn > auth.lifetimeCommittedCap) revert LifetimeCapExceeded();
        if (auth.activeAtRisk + buyIn > auth.maxTotalAtRisk) revert AtRiskCapExceeded();
        if (uint256(auth.activeGames) + 1 > auth.maxConcurrentGames) revert ConcurrentGamesExceeded();
        if (sessionExposure[sessionId] != 0) revert SessionAlreadyOpen();

        IERC20 token = IERC20(auth.usdc);
        if (token.balanceOf(address(this)) < buyIn) revert InsufficientBalance();

        auth.lifetimeCommitted += buyIn;
        auth.activeAtRisk += buyIn;
        auth.activeGames += 1;
        sessionExposure[sessionId] = buyIn;
        sessionVault[sessionId] = msg.sender;

        token.safeTransfer(msg.sender, buyIn);
        emit BuyInPulled(sessionId, msg.sender, buyIn);
        return buyIn;
    }

    /// @notice Vault-only: add chips to an already-open session (mid-sit rebuy).
    /// @dev Does not increment activeGames — same concurrent seat for the whole sit.
    function increaseBuyIn(bytes32 sessionId, uint256 buyIn, bytes32 gameTemplateId, uint32 leagueBit, bool rated)
        external
        nonReentrant
        returns (uint256)
    {
        if (buyIn == 0) revert ZeroAmount();
        if (sessionExposure[sessionId] == 0) revert SessionNotOpen();
        if (sessionVault[sessionId] != msg.sender) revert WrongVault();

        GameAuth storage auth = gameAuth;
        if (!auth.enabled) revert PermissionInactive();
        if (block.timestamp > auth.validUntil) revert PermissionExpired();
        if (msg.sender != auth.vault) revert WrongVault();
        if (gameTemplateId != auth.gameTemplateId) revert TemplateNotAllowed();
        if (leagueBit == 0 || (auth.leagueMask & leagueBit) == 0) revert LeagueNotAllowed();
        if (auth.ratedOnly && !rated) revert RatedRequired();
        if (buyIn > auth.maxSingleBuyIn) revert BuyInTooHigh();
        if (auth.lifetimeCommitted + buyIn > auth.lifetimeCommittedCap) revert LifetimeCapExceeded();
        if (auth.activeAtRisk + buyIn > auth.maxTotalAtRisk) revert AtRiskCapExceeded();

        IERC20 token = IERC20(auth.usdc);
        if (token.balanceOf(address(this)) < buyIn) revert InsufficientBalance();

        auth.lifetimeCommitted += buyIn;
        auth.activeAtRisk += buyIn;
        sessionExposure[sessionId] += buyIn;

        token.safeTransfer(msg.sender, buyIn);
        emit BuyInPulled(sessionId, msg.sender, buyIn);
        return buyIn;
    }

    /// @notice Vault that locked the session releases reserved exposure after settle/emergency.
    function releaseExposure(bytes32 sessionId, uint256 amount) external nonReentrant {
        if (sessionVault[sessionId] != msg.sender) revert WrongVault();
        uint256 exposed = sessionExposure[sessionId];
        if (exposed == 0) revert UnknownSession();
        if (amount > exposed) revert InsufficientBalance();

        sessionExposure[sessionId] = exposed - amount;
        GameAuth storage auth = gameAuth;
        if (amount >= auth.activeAtRisk) {
            auth.activeAtRisk = 0;
        } else {
            auth.activeAtRisk -= amount;
        }
        if (sessionExposure[sessionId] == 0) {
            delete sessionVault[sessionId];
            if (auth.activeGames > 0) {
                auth.activeGames -= 1;
            }
        }
        emit ExposureReleased(sessionId, amount);
    }

    function remainingLifetimeCap() external view returns (uint256) {
        GameAuth storage auth = gameAuth;
        if (!auth.enabled || block.timestamp > auth.validUntil || auth.lifetimeCommitted >= auth.lifetimeCommittedCap) {
            return 0;
        }
        return auth.lifetimeCommittedCap - auth.lifetimeCommitted;
    }

    function remainingAtRiskCap() external view returns (uint256) {
        GameAuth storage auth = gameAuth;
        if (!auth.enabled || block.timestamp > auth.validUntil || auth.activeAtRisk >= auth.maxTotalAtRisk) {
            return 0;
        }
        return auth.maxTotalAtRisk - auth.activeAtRisk;
    }

    function isSessionSigner(address signer) external view returns (bool) {
        GameAuth storage auth = gameAuth;
        return auth.enabled && block.timestamp <= auth.validUntil && auth.sessionSigner == signer;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
