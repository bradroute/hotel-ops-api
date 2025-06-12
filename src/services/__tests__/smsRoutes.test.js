// hotel-ops-api/src/services/__tests__/smsRoutes.test.js

const request = require("supertest");
const express = require("express");

// 1) Mock Supabase service
jest.mock("../supabaseService", () => ({
  getAllRequests: async () => [
    {
      id: "fake-id-1",
      from: "+15551234567",
      message: "Test message",
      department: "housekeeping",
      priority: "normal",
      created_at: "2025-06-05T10:00:00.000Z",
      acknowledged: false,
      completed: false,
    },
    {
      id: "fake-id-2",
      from: "+15559876543",
      message: "Another test",
      department: "maintenance",
      priority: "urgent",
      created_at: "2025-06-05T10:05:00.000Z",
      acknowledged: true,
      completed: false,
    },
  ],
  insertRequest: async () => {},
  findByTelnyxId: async () => {},
  acknowledgeRequestById: async () => {},
  completeRequestById: async () => {},
  getAnalyticsSummary: async () => {},
  getAnalyticsByDepartment: async () => {},
  getAnalyticsAvgResponseTime: async () => {},
  getAnalyticsDailyResponseTimes: async () => {},
}));

// 2) Load the ESM router module and grab its default export
const smsModule = require("../../routes/sms.js");
const smsRouter = smsModule.default || smsModule;

describe("GET /sms", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/sms", smsRouter);
  });

  it("returns JSON array of requests with status 200", async () => {
    const res = await request(app)
      .get("/sms")
      .expect("Content-Type", /json/)
      .expect(200);

    const body = res.body;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    // first item
    expect(body[0]).toMatchObject({
      id: "fake-id-1",
      from: "+15551234567",
      message: "Test message",
      department: "housekeeping",
      priority: "normal",
      acknowledged: false,
      completed: false,
    });

    // second item
    expect(body[1]).toMatchObject({
      id: "fake-id-2",
      from: "+15559876543",
      message: "Another test",
      department: "maintenance",
      priority: "urgent",
      acknowledged: true,
      completed: false,
    });
  });
});
