// Feature flags, read from server env. Keep the surface tiny — one
// exported predicate per flag so call sites read as plain English.
//
// campaignFlow: the Acast-style guided "Plan a campaign" front door that
// will eventually replace the buyer top-nav. Off by default; enable per
// environment with CAMPAIGN_FLOW=1 while it is built out behind the flag.
export function campaignFlowEnabled(): boolean {
  return process.env.CAMPAIGN_FLOW === "1";
}
