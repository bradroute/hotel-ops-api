import express from 'express';
import {
  getAnalyticsSummary,
  getAnalyticsByDepartment,
  getAnalyticsAvgResponseTime,
  getAnalyticsDailyResponseTimes
} from '../services/supabaseService.js';
import { asyncWrapper } from '../utils/asyncWrapper.js';

const router = express.Router();

router.get('/summary', asyncWrapper(async (req, res) => {
  const summary = await getAnalyticsSummary();
  res.json(summary);
}));

router.get('/by-department', asyncWrapper(async (req, res) => {
  const deptStats = await getAnalyticsByDepartment();
  res.json(deptStats);
}));

router.get('/avg-response-time', asyncWrapper(async (req, res) => {
  const avgTime = await getAnalyticsAvgResponseTime();
  res.json(avgTime);
}));

router.get('/daily-response-times', asyncWrapper(async (req, res) => {
  const dailyTimes = await getAnalyticsDailyResponseTimes();
  res.json(dailyTimes);
}));

export default router;
