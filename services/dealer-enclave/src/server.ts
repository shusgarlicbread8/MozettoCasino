import Fastify from "fastify";
import cors from "@fastify/cors";
import { EnclaveDealerRuntime } from "./api/runtime.js";
import {
  BindVrfBody,
  CommitBatchBody,
  DeliverPrivateCardsBody,
  OpenPublicCardBody,
  PrepareDecksBody,
} from "./api/shapes.js";
import { resolveAttestationMode } from "./attestation/index.js";

/**
 * Local mock enclave parent HTTP surface (Plan 05 internal dealer API).
 *
 * Production: this process is the *parent* that talks to the Nitro enclave over
 * vsock; secrets never leave the EIF. This scaffold runs the runtime in-process
 * with ENCLAVE_ATTESTATION_MODE=mock only.
 */
export async function buildEnclaveDealerServer(
  runtime = new EnclaveDealerRuntime(),
) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const mode = resolveAttestationMode();

  app.get("/health", async () => ({
    ok: true,
    service: "dealer-enclave",
    attestationMode: mode,
    productionTee: false,
    note:
      mode === "nitro"
        ? "nitro mode selected but COSE/PKI verification is stubbed — not a production TEE claim"
        : "mock attestation for Anvil/local",
  }));

  app.post("/internal/dealer/commit-batch", async (req, reply) => {
    const parsed = CommitBatchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await runtime.commitBatch(parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/internal/dealer/bind-vrf", async (req, reply) => {
    const parsed = BindVrfBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await runtime.bindVrf(parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/internal/dealer/prepare-decks", async (req, reply) => {
    const parsed = PrepareDecksBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await runtime.prepareDecks(parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/internal/dealer/open-public-card", async (req, reply) => {
    const parsed = OpenPublicCardBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await runtime.openPublicCard(parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/internal/dealer/deliver-private-cards", async (req, reply) => {
    const parsed = DeliverPrivateCardsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await runtime.deliverPrivateCards(parsed.data);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { session: string; epoch: string } }>(
    "/internal/dealer/attestation/:session/:epoch",
    async (req, reply) => {
      try {
        return await runtime.getAttestation(req.params.session, req.params.epoch);
      } catch (err) {
        return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  return app;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.js"));

if (isMain) {
  const port = Number(process.env.PORT ?? process.env.DEALER_ENCLAVE_PORT ?? 4013);
  const app = await buildEnclaveDealerServer();
  await app.listen({ port, host: "0.0.0.0" });
}
