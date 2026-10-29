/**
 * Tests for checkMenu.util
 *
 * The checkMenu.util.js script calls check() at module load time.
 * check() is async - process.exit is called after the promise chain resolves.
 * We need to drain the event loop before asserting.
 */
describe("checkMenu util", () => {
  let exitMock: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- the mock swallows process.exit; the assertion is on its calls
    exitMock = jest.spyOn(process, "exit").mockImplementation((() => { }) as () => never);
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  it("should call process.exit(0) on success", async () => {
    jest.doMock("../../utils/env.util");

    jest.doMock("../../config", () => ({
      Connection: jest.fn().mockResolvedValue(undefined),
      db: {
        models: {
          RoleMenuPermission: {
            findAll: jest.fn().mockResolvedValue([{ id: 1 }]),
          },
        },
      },
      Sequelize: null,
    }));

    jest.doMock("../../models", () => ({
      MenuGroup: {
        findAll: jest.fn().mockResolvedValue([{ id: 1, name: "Test" }]),
      },
      Role: {
        findAll: jest.fn().mockResolvedValue([{ id: 1, name: "Admin" }]),
      },
    }));

    // require triggers checkMenu.util.js which calls check()
    // check() is async so we need to wait for the event loop
    /* eslint-disable @typescript-eslint/no-require-imports -- the module runs check() at load; isolated per test */
    require("../../utils/checkMenu.util");
    /* eslint-enable @typescript-eslint/no-require-imports */

    // Wait for the async check() to complete and call process.exit
    await new Promise((resolve) => setImmediate(resolve));

    expect(exitMock).toHaveBeenCalledWith(0);
  });

  it("should call process.exit(1) on error", async () => {
    jest.doMock("../../utils/env.util");

    jest.doMock("../../config", () => ({
      Connection: jest.fn().mockResolvedValue(undefined),
      db: {
        models: {
          RoleMenuPermission: {
            findAll: jest.fn().mockResolvedValue([]),
          },
        },
      },
      Sequelize: null,
    }));

    jest.doMock("../../models", () => ({
      MenuGroup: {
        findAll: jest.fn().mockRejectedValue(new Error("DB error")),
      },
    }));

    /* eslint-disable @typescript-eslint/no-require-imports -- the module runs check() at load; isolated per test */
    require("../../utils/checkMenu.util");
    /* eslint-enable @typescript-eslint/no-require-imports */

    await new Promise((resolve) => setImmediate(resolve));

    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
