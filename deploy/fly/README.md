# Fly.io recipes (WP-086)
#
# Each `*.toml` is a deploy config for one long-lived service.
# From repo root:
#
#   fly apps create mozetto-<svc>-staging
#   fly secrets set -a mozetto-<svc>-staging KEY=value ...
#   fly deploy -c deploy/fly/<svc>.toml -a mozetto-<svc>-staging
#
# Prefer Fly private networking / `.internal` DNS for dealer, verifier, and agent.
# See docs/WP-086_HOSTED_DEPLOYMENT.md for env checklists.
