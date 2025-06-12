import request from 'supertest';
import express from 'express';
import requestsRouter from '../../routes/requests.js'; // ← fixed relative path

describe("requests router", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // mount your router under /requests
    app.use("/requests", requestsRouter);
  });

  it("GET /requests returns JSON array with status 200", async () => {
    const res = await request(app)
      .get("/requests")
      .expect("Content-Type", /json/)
      .expect(200);

    // basic sanity check
    expect(Array.isArray(res.body)).toBe(true);
  });

  // … your other tests for POST /requests/:id/acknowledge and /complete can stay the same
});
