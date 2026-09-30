// Stand-in for the real Supabase client.
//
// The structural checks exercise pure functions only (describeLiters,
// buildBudgetInsights, activeVehicles), so no live client is needed and no
// query is ever performed. This stub exists purely so importing
// lib/services/budgetAnalytics.ts resolves.
module.exports = { supabase: { rpc: async () => ({ data: null, error: null }) } };
