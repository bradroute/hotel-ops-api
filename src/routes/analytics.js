// src/routes/analytics.js
import express from 'express';
import * as supabaseService from '../services/supabaseService.js';

const router = express.Router();

router.get('/full', async (req, res) => {
  try {
    // Read hotel_id from query string (underscore) to match front-end
    const { hotel_id: hotelId, startDate, endDate } = req.query;
    if (!hotelId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    // Normalize date range to include full day
    const startISO = new Date(startDate).toISOString();
    const endObj = new Date(endDate);
    endObj.setHours(23, 59, 59, 999);
    const endISO = endObj.toISOString();

    // Fetch all metrics in parallel (Phases 1-4 + completion rates)
    const [
      totalRequests,
      avgAckTime,
      missedSLAs,
      requestsPerDay,
      topDepartments,
      commonWords,
      vipCount,
      repeatPercent,
      estimatedRevenue,
      laborTimeSaved,
      serviceScoreEstimate,
      serviceScoreTrend,
      priorityBreakdown,
      avgCompletion,
      repeatGuestTrend,
      enhancedLaborTimeSaved,
      requestsPerOccupiedRoom,
      topEscalationReasons,
      dailyCompletionRate,
      weeklyCompletionRate,
      monthlyCompletionRate
    ] = await Promise.all([
      supabaseService.getTotalRequests(startISO, endISO, hotelId),
      supabaseService.getAvgAckTime(startISO, endISO, hotelId),
      supabaseService.getMissedSLACount(startISO, endISO, hotelId),
      supabaseService.getRequestsPerDay(startISO, endISO, hotelId),
      supabaseService.getTopDepartments(startISO, endISO, hotelId),
      supabaseService.getCommonRequestWords(startISO, endISO, hotelId),
      // Now scoped by hotelId
      supabaseService.getVIPGuestCount(startISO, endISO, hotelId),
      supabaseService.getRepeatRequestRate(startISO, endISO, hotelId),
      supabaseService.getEstimatedRevenue(startISO, endISO, hotelId),
      supabaseService.getLaborTimeSaved(startISO, endISO, hotelId),
      supabaseService.getServiceScoreEstimate(startISO, endISO, hotelId),
      supabaseService.getServiceScoreTrend(startISO, endISO, hotelId),
      supabaseService.getPriorityBreakdown(startISO, endISO, hotelId),
      supabaseService.getAvgCompletionTime(startISO, endISO, hotelId),
      supabaseService.getRepeatGuestTrend(startISO, endISO, hotelId),
      supabaseService.getEnhancedLaborTimeSaved(startISO, endISO, hotelId),
      supabaseService.getRequestsPerOccupiedRoom(startISO, endISO, hotelId),
      supabaseService.getTopEscalationReasons(startISO, endISO, hotelId),
      supabaseService.getDailyCompletionRate(startISO, endISO, hotelId),
      supabaseService.getWeeklyCompletionRate(startISO, endISO, hotelId),
      supabaseService.getMonthlyCompletionRate(startISO, endISO, hotelId)
    ]);

    res.json({
      total: totalRequests,
      avgAck: avgAckTime,
      missedSLAs,
      requestsPerDay,
      topDepartments,
      commonWords,
      vipCount,
      repeatPercent,
      estimatedRevenue,
      laborTimeSaved,
      serviceScoreEstimate,
      serviceScoreTrend,
      priorityBreakdown,
      avgCompletion,
      repeatGuestTrend,
      enhancedLaborTimeSaved,
      requestsPerOccupiedRoom,
      topEscalationReasons,
      dailyCompletionRate,
      weeklyCompletionRate,
      monthlyCompletionRate
    });

  } catch (err) {
    console.error('🔥 Analytics API error:', err.stack || err);
    res.status(500).json({ error: 'API Error: ' + (err.message || 'Unknown error') });
  }
});

export default router;
