import express from 'express';
import * as supabaseService from '../services/supabaseService.js';

const router = express.Router();

router.get('/full', async (req, res) => {
  try {
    const { hotelId, startDate, endDate } = req.query;
    if (!hotelId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    // Normalize date range to include full end-of-day
    const startISO = new Date(startDate).toISOString();
    const endObj = new Date(endDate);
    endObj.setHours(23, 59, 59, 999);
    const endISO = endObj.toISOString();

    // Fetch metrics in parallel (Phases 1-4)
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
      avgCompletionTime,
      repeatGuestTrend,
      enhancedLaborTimeSaved,
      requestsPerOccupiedRoom,
      topEscalationReasons
    ] = await Promise.all([
      // Phase 1
      supabaseService.getTotalRequests(startISO, endISO, hotelId),
      supabaseService.getAvgAckTime(startISO, endISO, hotelId),
      supabaseService.getMissedSLACount(startISO, endISO, hotelId),
      supabaseService.getRequestsPerDay(startISO, endISO, hotelId),
      // Phase 2
      supabaseService.getTopDepartments(startISO, endISO, hotelId),
      supabaseService.getCommonRequestWords(startISO, endISO, hotelId),
      supabaseService.getVIPGuestCount(startISO, endISO),
      supabaseService.getRepeatRequestRate(startISO, endISO, hotelId),
      // Phase 3
      supabaseService.getEstimatedRevenue(startISO, endISO, hotelId),
      supabaseService.getLaborTimeSaved(startISO, endISO, hotelId),
      supabaseService.getServiceScoreEstimate(startISO, endISO, hotelId),
      // Phase 4
      supabaseService.getServiceScoreTrend(startISO, endISO, hotelId),
      supabaseService.getPriorityBreakdown(startISO, endISO, hotelId),
      supabaseService.getAvgCompletionTime(startISO, endISO, hotelId),  // use correct function
      supabaseService.getRepeatGuestTrend(startISO, endISO, hotelId),
      supabaseService.getEnhancedLaborTimeSaved(startISO, endISO, hotelId),
      supabaseService.getRequestsPerOccupiedRoom(startISO, endISO, hotelId),
      supabaseService.getTopEscalationReasons(startISO, endISO, hotelId)
    ]);

    // Return combined JSON response
    res.json({
      // Phase 1
      total: totalRequests,
      avgAck: avgAckTime,
      missedSLAs,
      requestsPerDay,
      // Phase 2
      topDepartments,
      commonWords,
      vipCount,
      repeatPercent,
      // Phase 3
      estimatedRevenue,
      laborTimeSaved,
      serviceScoreEstimate,
      // Phase 4
      serviceScoreTrend,
      priorityBreakdown,
      avgCompletion: avgCompletionTime,
      repeatGuestTrend,
      enhancedLaborTimeSaved,
      requestsPerOccupiedRoom,
      topEscalationReasons
    });

  } catch (err) {
    console.error('🔥 Analytics API error:', err.stack || err.message || err);
    res.status(500).json({ error: 'API Error: ' + (err.message || 'Unknown error') });
  }
});

export default router;
