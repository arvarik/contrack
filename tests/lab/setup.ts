// Connector lab setup, after tests/integration-setup.ts (a temp DATA_DIR, AI
// in mock mode). The lab's servers listen on 127.0.0.1, which the connectors
// refuse unless this switch is on.
process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
