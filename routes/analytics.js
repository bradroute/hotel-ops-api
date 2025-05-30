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
