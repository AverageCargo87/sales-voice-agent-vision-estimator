import { env } from "./utils/env.js";
import { readState, patchState } from "./utils/state.js";
import { ElevenLabsClient, type PhoneNumberCreateBody } from "./utils/elevenlabs.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("04 phone");
const client = new ElevenLabsClient();

const state = readState();
if (!state.agent_id) {
  log.error("No agent yet: run npm run create-agent first");
  process.exit(1);
}

const phoneNumber = env.sip.phoneNumber();
const inbound = env.sip.inboundUri();
const outbound = env.sip.outboundUri();
const username = env.sip.username();
const password = env.sip.password();

if (!phoneNumber || !inbound || !outbound) {
  log.error("Set SIP_PHONE_NUMBER, SIP_INBOUND_URI and SIP_OUTBOUND_URI in .env (plus SIP_USERNAME / SIP_PASSWORD if the trunk uses digest auth)");
  process.exit(1);
}

if (state.phone_number_id) {
  log.warn(`phone_number_id already in state (${state.phone_number_id}): run teardown first to re-attach`);
  process.exit(0);
}

// Gotcha #5: a SIP trunk (Telnyx here) is provider "sip_trunk", not "twilio".
const credentials = { ...(username ? { username } : {}), ...(password ? { password } : {}) };
const body: PhoneNumberCreateBody = {
  phone_number: phoneNumber,
  label: "Acme Steel Homes inbound",
  provider: "sip_trunk",
  inbound_trunk: { address: inbound, ...credentials },
  outbound_trunk: { address: outbound, ...credentials },
};

log.step("Creating the SIP phone number in ElevenLabs...");
const { phone_number_id: phoneId } = await client.createPhoneNumber(body);
log.ok(`Phone number created: ${phoneId}`);
patchState({ phone_number_id: phoneId });

log.step(`Assigning it to agent ${state.agent_id}...`);
await client.assignPhoneNumberToAgent(phoneId, state.agent_id);
log.ok("Done: inbound calls on this number now reach the agent");
log.info("Check: the number is listed under Phone Numbers, and the trunk's outbound URI points at the ElevenLabs SIP endpoint");
