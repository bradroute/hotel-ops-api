const supabase = require('../supabaseClient');

// 1️⃣ Total Requests
async function getTotalRequests(startDate, endDate) {
  const { count, error } = await supabase
    .from('requests')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  
  if (error) throw error;
  return count;
}

// 2️⃣ Avg Response Time (acknowledged_at - created_at)
async function getAvgResponseTime(startDate, endDate) {
  const { data, error } = await supabase
    .rpc('avg_response_time', { start_date: startDate, end_date: endDate });

  if (error) throw error;
  return data;
}

// 3️⃣ Avg Completion Time (completed_at - created_at)
async function getAvgCompletionTime(startDate, endDate) {
  const { data, error } = await supabase
    .rpc('avg_completion_time', { start_date: startDate, end_date: endDate });

  if (error) throw error;
  return data;
}

// 4️⃣ SLA Compliance (example: 10 min SLA for normal requests)
async function getSLACompliance(startDate, endDate, slaSeconds = 600) {
  const { data, error } = await supabase
    .rpc('sla_compliance', { start_date: startDate, end_date: endDate, sla_seconds: slaSeconds });

  if (error) throw error;
  return data;
}

// 5️⃣ Escalations Triggered
async function getEscalationCount(startDate, endDate) {
  const { count, error } = await supabase
    .from('requests')
    .select('*', { count: 'exact', head: true })
    .eq('escalation_triggered', true)
    .gte('created_at', startDate)
    .lte('created_at', endDate);

  if (error) throw error;
  return count;
}

// 6️⃣ Department Breakdown
async function getRequestsByDepartment(startDate, endDate) {
  const { data, error } = await supabase
    .from('requests')
    .select('department, count:count(*)')
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .group('department');

  if (error) throw error;
  return data;
}

module.exports = {
  getTotalRequests,
  getAvgResponseTime,
  getAvgCompletionTime,
  getSLACompliance,
  getEscalationCount,
  getRequestsByDepartment
};
