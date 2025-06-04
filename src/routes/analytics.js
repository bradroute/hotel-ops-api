// src/routes/analytics.js

const express = require('express');
const router = express.Router();

const {
  getAnalyticsSummary,
  getAnalyticsByDepartment,
  getAnalyticsAvgResponseTime,
  getAnalyticsDailyResponseTimes,
} = require('../services/supabaseService');

const { asyncWrapper } = require('../utils/asyncWrapper');

// GET /analytics/summary
router.get(
  '/summary',
  asyncWrapper(async (req, res) => {
    const summary = await getAnalyticsSummary();
    return res.json(summary);
  })
);

// GET /analytics/by-department
router.get(
  '/by-department',
  asyncWrapper(async (req, res) => {
    const deptStats = await getAnalyticsByDepartment();
    return res.json(deptStats);
  })
);

// GET /analytics/avg-response-time
router.get(
  '/avg-response-time',
  asyncWrapper(async (req, res) => {
    const avgTime = await getAnalyticsAvgResponseTime();
    return res.json(avgTime);
  })
);

// GET /analytics/daily-response-times
router.get(
  '/daily-response-times',
  asyncWrapper(async (req, res) => {
    const dailyTimes = await getAnalyticsDailyResponseTimes();
    return res.json(dailyTimes);
  })
);

module.exports = router;
