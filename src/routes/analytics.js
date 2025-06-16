import express from 'express';
import * as supabaseService from '../services/supabaseService.js';

const router = express.Router();

router.get('/full', async (req, res) => {
  try {
    const { hotelId, startDate, endDate } = req.query;
    if (!hotelId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    const [
      totalRequests,
      slaCompliance,
      avgCompletionTime,
      escalationCount,
      deptBreakdown,
      requestVolumeGrowth,
      repeatGuestActivity,
      priorityBreakdown,
      estimatedRevenue,
      dailyResponseTimes
    ] = await Promise.all([
      supabaseService.getTotalRequests(startDate, endDate, hotelId),
      supabaseService.getSLACompliance(startDate, endDate, 600, hotelId),
      supabaseService.getAvgCompletionTime(startDate, endDate, hotelId),
      supabaseService.getEscalationCount(startDate, endDate, 600, hotelId),
      supabaseService.getRequestsByDepartment(startDate, endDate, hotelId),
      supabaseService.getRequestVolumeGrowth(startDate, endDate, hotelId),
      supabaseService.getRepeatGuestActivity(startDate, endDate, hotelId),
      supabaseService.getRequestsByPriority(startDate, endDate, hotelId),
      supabaseService.getEstimatedRevenue(startDate, endDate, hotelId),
      supabaseService.getDailyResponseTimes(startDate, endDate, hotelId),
    ]);

    res.json({
      total: totalRequests,
      sla: slaCompliance,
      avgComplete: avgCompletionTime,
      escalations: escalationCount,
      deptBreakdown,
      volumeGrowth: requestVolumeGrowth,
      repeatGuests: repeatGuestActivity,
      priority: priorityBreakdown,
      revenue: estimatedRevenue,
      dailyResp: dailyResponseTimes,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'API error: ' + err.message });
  }
});

export default router;
