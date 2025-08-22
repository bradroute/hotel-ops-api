// src/routes/analytics.js — updated (Aug 21, 2025)
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

    // Optional timezone offset (minutes). Default ≈ America/Chicago (CDT = -300, CST = -360)
    const tzOffsetMinutes = Number.parseInt(req.query.tzOffsetMinutes, 10);
    const tzOffset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : -300;

    // Normalize date range to include full end day (inclusive → end of day)
    const startISO = new Date(startDate).toISOString();
    const endObj = new Date(endDate);
    endObj.setHours(23, 59, 59, 999);
    const endISO = endObj.toISOString();

    // Optional tuning for common words (safe defaults)
    const commonTopN = req.query.commonTopN ? Number(req.query.commonTopN) : 5;
    const commonMinLen = req.query.commonMinLen ? Number(req.query.commonMinLen) : 3;
    const commonMinCount = req.query.commonMinCount ? Number(req.query.commonMinCount) : 2;

    // Fetch all metrics in parallel (aligned with supabaseService.js merged file)
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
    ] = await Promise.all([
      supabaseService.getTotalRequests(startISO, endISO, hotelId),
      supabaseService.getAvgAckTime(startISO, endISO, hotelId),
      supabaseService.getMissedSLACount(startISO, endISO, hotelId),
      supabaseService.getRequestsByHour(startISO, endISO, hotelId, tzOffset), // ← replaced per-day with by-hour
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
    ]);

    // Send a single, clean payload
    res.json({
      total: totalRequests,
      avgAck: avgAckTime,
      missedSLAs,
      requestsByHour, // ← new key for the by‑hour chart (0–23)
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
    });
  } catch (err) {
    console.error('🔥 Analytics API error:', err.stack || err);
    res.status(500).json({ error: 'API Error: ' + (err.message || 'Unknown error') });
  }
});

export default router;
