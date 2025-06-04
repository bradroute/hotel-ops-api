// hotel-ops-api/src/services/__tests__/supabaseService.test.js

/**
 * Unit tests for every function exported by supabaseService.js.
 * Each test uses jest.isolateModules + jest.doMock('@supabase/supabase-js', …)
 * so that we can supply a “fakeSupabase” stub whose methods match the real chain:
 *
 *   getAllRequests:     supabase.from(...).select(...).order(...)
 *   insertRequest:      supabase.from(...).insert(...).select(...)
 *   findByTelnyxId:     supabase.from(...).select(...).eq(...).maybeSingle()
 *   acknowledgeById:    supabase.from(...).update(...).eq(...).select()
 *   completeById:       supabase.from(...).update(...).eq(...).select()
 *   getAnalyticsSummary: three calls to supabase.from(...).select(...).gte(...)
 *   getAnalyticsByDepartment: supabase.from(...).select(...)
 *   getAnalyticsAvgResponseTime: supabase.from(...).select(...).eq(...)
 *   getAnalyticsDailyResponseTimes: supabase.rpc(...)
 */

describe("supabaseService.getAllRequests", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to an array of requests when Supabase returns data", async () => {
    jest.isolateModules(() => {
      // stub: .from(...).select(...).order()
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "test-id-123",
                    from: "+15551234567",
                    message: "Test message body",
                    department: "maintenance",
                    priority: "normal",
                    created_at: "2025-06-04T12:00:00.000Z",
                    acknowledged: false,
                    completed: false,
                  },
                ],
                error: null,
              }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAllRequests } = require("../supabaseService");
      return expect(getAllRequests()).resolves.toEqual([
        {
          id: "test-id-123",
          from: "+15551234567",
          message: "Test message body",
          department: "maintenance",
          priority: "normal",
          created_at: "2025-06-04T12:00:00.000Z",
          acknowledged: false,
          completed: false,
        },
      ]);
    });
  });

  it("throws an error if Supabase returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            order: () =>
              Promise.resolve({
                data: null,
                error: { message: "DB error occurred" },
              }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAllRequests } = require("../supabaseService");
      return expect(getAllRequests()).rejects.toThrow("DB error occurred");
    });
  });
});

describe("supabaseService.insertRequest", () => {
  const someArgs = {
    from: "+15551234567",
    message: "Room 101 needs towels",
    department: "housekeeping",
    priority: "normal",
    telnyx_id: "abc-123",
  };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to the inserted row when Supabase returns data", async () => {
    const fakeResponseRow = {
      id: "row-1",
      ...someArgs,
      created_at: "2025-06-04T13:00:00.000Z",
      acknowledged: false,
      completed: false,
    };

    jest.isolateModules(() => {
      // stub: .from(...).insert(...).select()
      const fakeSupabase = {
        from: () => ({
          insert: () => ({
            select: async () => ({
              data: [fakeResponseRow],
              error: null,
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { insertRequest } = require("../supabaseService");
      return expect(insertRequest(someArgs)).resolves.toEqual(fakeResponseRow);
    });
  });

  it("throws an error if Supabase returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          insert: () => ({
            select: async () => ({
              data: null,
              error: { message: "DB error occurred" },
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { insertRequest } = require("../supabaseService");
      return expect(insertRequest(someArgs)).rejects.toThrow("DB error occurred");
    });
  });
});

describe("supabaseService.findByTelnyxId", () => {
  const telnyxId = "test-telnyx-id";

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to an object when Supabase returns a row", async () => {
    const fakeRow = { id: "row-123" };

    jest.isolateModules(() => {
      // stub: .from(...).select(...).eq(...).maybeSingle()
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            eq: (_col, _val) => ({
              maybeSingle: async () => ({ data: fakeRow, error: null }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { findByTelnyxId } = require("../supabaseService");
      return expect(findByTelnyxId(telnyxId)).resolves.toEqual(fakeRow);
    });
  });

  it("throws an error if Supabase returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            eq: (_col, _val) => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: "DB error occurred" },
              }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { findByTelnyxId } = require("../supabaseService");
      return expect(findByTelnyxId(telnyxId)).rejects.toThrow("DB error occurred");
    });
  });
});

describe("supabaseService.acknowledgeRequestById", () => {
  const id = "row-123";

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to the updated row when Supabase update succeeds", async () => {
    const fakeUpdatedRow = {
      id,
      acknowledged: true,
      acknowledged_at: "2025-06-04T14:00:00.000Z",
    };

    jest.isolateModules(() => {
      // stub: .from(...).update(...).eq(...).select()
      const fakeSupabase = {
        from: () => ({
          update: () => ({
            eq: (_col, _val) => ({
              select: async () => ({
                data: [fakeUpdatedRow],
                error: null,
              }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { acknowledgeRequestById } = require("../supabaseService");
      return expect(acknowledgeRequestById(id)).resolves.toEqual(fakeUpdatedRow);
    });
  });

  it("throws an error if Supabase returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          update: () => ({
            eq: (_col, _val) => ({
              select: async () => ({
                data: null,
                error: { message: "Update failed" },
              }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { acknowledgeRequestById } = require("../supabaseService");
      return expect(acknowledgeRequestById(id)).rejects.toThrow("Update failed");
    });
  });
});

describe("supabaseService.completeRequestById", () => {
  const id = "row-456";

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to the updated row when Supabase update succeeds", async () => {
    const fakeUpdatedRow = {
      id,
      completed: true,
      completed_at: "2025-06-04T15:00:00.000Z",
    };

    jest.isolateModules(() => {
      // stub: .from(...).update(...).eq(...).select()
      const fakeSupabase = {
        from: () => ({
          update: () => ({
            eq: (_col, _val) => ({
              select: async () => ({
                data: [fakeUpdatedRow],
                error: null,
              }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { completeRequestById } = require("../supabaseService");
      return expect(completeRequestById(id)).resolves.toEqual(fakeUpdatedRow);
    });
  });

  it("throws an error if Supabase returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          update: () => ({
            eq: (_col, _val) => ({
              select: async () => ({
                data: null,
                error: { message: "Complete failed" },
              }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { completeRequestById } = require("../supabaseService");
      return expect(completeRequestById(id)).rejects.toThrow("Complete failed");
    });
  });
});

describe("supabaseService.getAnalyticsSummary", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to an object of counts when Supabase returns counts", async () => {
    // Prepare three counts: 5, 20, 50
    const counts = [5, 20, 50];

    jest.isolateModules(() => {
      // stub: .from(...).select(...).gte(...).then(...)
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            gte: (_col, _val) => ({
              then: (cb) => {
                const nextCount = counts.shift();
                cb({ count: nextCount, error: null });
              },
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsSummary } = require("../supabaseService");
      return expect(getAnalyticsSummary()).resolves.toEqual({
        today: 5,
        this_week: 20,
        this_month: 50,
      });
    });
  });

  it("throws an error if any Supabase call returns an error", async () => {
    jest.isolateModules(() => {
      let callIndex = 0;
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            gte: (_col, _val) => ({
              then: (cb) => {
                callIndex++;
                if (callIndex === 2) {
                  // Simulate error on second call
                  cb({ data: null, error: { message: "DB error occurred" } });
                } else {
                  cb({ count: 0, error: null });
                }
              },
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsSummary } = require("../supabaseService");
      return expect(getAnalyticsSummary()).rejects.toThrow("DB error occurred");
    });
  });
});

describe("supabaseService.getAnalyticsByDepartment", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to an object of department-counts when Supabase returns data", async () => {
    const fakeRows = [
      { department: "housekeeping" },
      { department: "housekeeping" },
      { department: "maintenance" },
    ];

    jest.isolateModules(() => {
      // stub: .from(...).select()
      const fakeSupabase = {
        from: () => ({
          select: async () => ({
            data: fakeRows,
            error: null,
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsByDepartment } = require("../supabaseService");
      return expect(getAnalyticsByDepartment()).resolves.toEqual({
        housekeeping: 2,
        maintenance: 1,
      });
    });
  });

  it("throws an error if Supabase returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          select: async () => ({
            data: null,
            error: { message: "DB error occurred" },
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsByDepartment } = require("../supabaseService");
      return expect(getAnalyticsByDepartment()).rejects.toThrow("DB error occurred");
    });
  });
});

describe("supabaseService.getAnalyticsAvgResponseTime", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to an object with average_response_time_minutes when data is present", async () => {
    const now = new Date("2025-06-05T00:00:00.000Z");
    const tenMinLater = new Date(now.getTime() + 10 * 60000).toISOString();
    const twentyMinLater = new Date(now.getTime() + 20 * 60000).toISOString();

    const fakeRows = [
      { created_at: now.toISOString(), acknowledged_at: tenMinLater },
      { created_at: now.toISOString(), acknowledged_at: twentyMinLater },
    ];

    jest.isolateModules(() => {
      // stub: .from(...).select(...).eq(...).then()
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            eq: (_col, _val) => ({
              then: (cb) => cb({ data: fakeRows, error: null }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsAvgResponseTime } = require("../supabaseService");
      return expect(getAnalyticsAvgResponseTime()).resolves.toEqual({
        average_response_time_minutes: 15.0,
      });
    });
  });

  it("resolves to { average_response_time_minutes: 0 } when no valid rows", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            eq: (_col, _val) => ({
              then: (cb) => cb({ data: [], error: null }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsAvgResponseTime } = require("../supabaseService");
      return expect(getAnalyticsAvgResponseTime()).resolves.toEqual({
        average_response_time_minutes: 0.0,
      });
    });
  });

  it("throws an error if Supabase returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        from: () => ({
          select: () => ({
            eq: (_col, _val) => ({
              then: (cb) => cb({ data: null, error: { message: "DB error occurred" } }),
            }),
          }),
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsAvgResponseTime } = require("../supabaseService");
      return expect(getAnalyticsAvgResponseTime()).rejects.toThrow("DB error occurred");
    });
  });
});

describe("supabaseService.getAnalyticsDailyResponseTimes", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("resolves to an array of daily response times when RPC succeeds", async () => {
    const fakeRpcResult = [
      { day: "2025-06-01", avg_minutes: 5.2 },
      { day: "2025-06-02", avg_minutes: 7.8 },
    ];

    jest.isolateModules(() => {
      const fakeSupabase = {
        rpc: async () => ({
          data: fakeRpcResult,
          error: null,
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsDailyResponseTimes } = require("../supabaseService");
      return expect(getAnalyticsDailyResponseTimes()).resolves.toEqual(fakeRpcResult);
    });
  });

  it("throws an error if RPC returns an error", async () => {
    jest.isolateModules(() => {
      const fakeSupabase = {
        rpc: async () => ({
          data: null,
          error: { message: "RPC error occurred" },
        }),
      };

      jest.doMock("@supabase/supabase-js", () => ({
        createClient: () => fakeSupabase,
      }));

      const { getAnalyticsDailyResponseTimes } = require("../supabaseService");
      return expect(getAnalyticsDailyResponseTimes()).rejects.toThrow("RPC error occurred");
    });
  });
});
