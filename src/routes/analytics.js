// src/routes/analytics.js
import express from 'express';
import * as supabaseService from '../services/supabaseService.js';

const router = express.Router();

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}
function endOfDayISO(input) {
  const d = new Date(input);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
function intOrDefault(v, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

router.get('/full', async (req, res) => {
  try {
    const { hotel_id: hotelId, startDate, endDate } = req.query;
    if (!hotelId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required query params: hotel_id, startDate, endDate' });
    }

    const startObj = new Date(startDate);
    const endObj   = new Date(endDate);
    if (!isValidDate(startObj) || !isValidDate(endObj)) {
      return res.status(400).json({ error: 'Invalid date format for startDate or endDate' });
    }

    // Timezone offset (minutes). Default ≈ America/Chicago (-300)
    const tzOffset = clamp(intOrDefault(req.query.tzOffsetMinutes, -300), -720, 840);

    // Inclusive end-of-day range
    const startISO = startObj.toISOString();
    const endISO   = endOfDayISO(endObj);

    // Optional tuning for common words (safe + bounded)
    const commonTopN     = clamp(intOrDefault(req.query.commonTopN, 5), 1, 25);
    const commonMinLen   = clamp(intOrDefault(req.query.commonMinLen, 3), 2, 12);
    const commonMinCount = clamp(intOrDefault(req.query.commonMinCount, 2), 1, 50);

    const [
      totalRequests,
      avgAckTime,
      missedSLAs,
      requestsByHour,
      topDepartments,
      commonWords,
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
      dailyCompletionRate,
      weeklyCompletionRate,
      monthlyCompletionRate,
      sentimentTrend,
      sentimentBreakdown,
    ] = await Promise.all([
      supabaseService.getTotalRequests(startISO, endISO, hotelId),
      supabaseService.getAvgAckTime(startISO, endISO, hotelId),
      supabaseService.getMissedSLACount(startISO, endISO, hotelId),
      supabaseService.getRequestsByHour(startISO, endISO, hotelId, tzOffset),
      supabaseService.getTopDepartments(startISO, endISO, hotelId),
      supabaseService.getCommonRequestWords(startISO, endISO, hotelId, {
        topN: commonTopN,
        minLen: commonMinLen,
        minCount: commonMinCount,
      }),
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
      supabaseService.getDailyCompletionRate(startISO, endISO, hotelId),
      supabaseService.getWeeklyCompletionRate(startISO, endISO, hotelId),
      supabaseService.getMonthlyCompletionRate(startISO, endISO, hotelId),
      supabaseService.getSentimentTrend(startISO, endISO, hotelId, tzOffset),
      supabaseService.getSentimentBreakdown(startISO, endISO, hotelId),
    ]);

    return res.json({
      total: totalRequests,
      avgAck: avgAckTime,
      missedSLAs,
      requestsByHour,
      topDepartments,
      commonWords,
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
      dailyCompletionRate,
      weeklyCompletionRate,
      monthlyCompletionRate,
      sentimentTrend,
      sentimentBreakdown,
    });
  } catch (err) {
    console.error('🔥 Analytics API error:', err.stack || err);
    return res.status(500).json({ error: 'API Error: ' + (err.message || 'Unknown error') });
  }
});

export default router;
