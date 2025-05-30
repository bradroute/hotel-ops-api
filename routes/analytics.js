const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [today, week, month] = await Promise.all([
      supabase
        .from('HotelCrosbyRequests')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfToday.toISOString()),

      supabase
        .from('HotelCrosbyRequests')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfWeek.toISOString()),

      supabase
        .from('HotelCrosbyRequests')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfMonth.toISOString()),
    ]);

    res.json({
      today: today.count,
      this_week: week.count,
      this_month: month.count,
    });
  } catch (err) {
    console.error('❌ Error fetching analytics summary:', err.message);
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

module.exports = router;

router.get('/by-department', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('HotelCrosbyRequests')
      .select('department');

    if (error) throw error;

    const result = {};

    data.forEach(row => {
      const dept = row.department || 'unknown';
      result[dept] = (result[dept] || 0) + 1;
    });

    res.json(result);
  } catch (err) {
    console.error('❌ Error fetching department analytics:', err.message);
    res.status(500).json({ error: 'Failed to fetch department stats' });
  }
});

router.get('/avg-response-time', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('HotelCrosbyRequests')
      .select('created_at, acknowledged_at')
      .eq('acknowledged', true);

    if (error) throw error;

    const diffsInMinutes = data
      .filter(row => row.created_at && row.acknowledged_at)
      .map(row => {
        const created = new Date(row.created_at);
        const acknowledged = new Date(row.acknowledged_at);
        const diffMs = acknowledged - created;
        return diffMs / (1000 * 60); // Convert ms to minutes
      });

    const avg =
      diffsInMinutes.length > 0
        ? diffsInMinutes.reduce((a, b) => a + b, 0) / diffsInMinutes.length
        : 0;

    res.json({
      average_response_time_minutes: parseFloat(avg.toFixed(2)),
    });
  } catch (err) {
    console.error('❌ Error calculating average response time:', err.message);
    res.status(500).json({ error: 'Failed to calculate average response time' });
  }
});
