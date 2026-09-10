/**
 * Tests for generateSwagger util
 */
const { mergeComponents } = require("../../utils/generateSwagger.util");

describe("mergeComponents", () => {
  it("should deep merge securitySchemes", () => {
    const target = {
      securitySchemes: { bearerAuth: { type: "http" } },
    };
    const source = {
      securitySchemes: { apiKeyAuth: { type: "apiKey" } },
    };

    const result = mergeComponents(target, source);

    expect(result.securitySchemes).toEqual({
      bearerAuth: { type: "http" },
      apiKeyAuth: { type: "apiKey" },
    });
    expect(target.securitySchemes).not.toHaveProperty("apiKeyAuth");
  });

  it("should deep merge schemas", () => {
    const target = { schemas: { User: { type: "object" } } };
    const source = { schemas: { Post: { type: "object" } } };

    const result = mergeComponents(target, source);

    expect(result.schemas).toEqual({
      User: { type: "object" },
      Post: { type: "object" },
    });
  });

  it("should merge parameters", () => {
    const target = { parameters: { PageParam: {} } };
    const source = { parameters: { LimitParam: {} } };

    const result = mergeComponents(target, source);

    expect(result.parameters).toEqual({
      PageParam: {},
      LimitParam: {},
    });
  });

  it("should merge requestBodies", () => {
    const target = { requestBodies: { CreateUser: {} } };
    const source = { requestBodies: { UpdateUser: {} } };

    const result = mergeComponents(target, source);

    expect(result.requestBodies).toEqual({
      CreateUser: {},
      UpdateUser: {},
    });
  });

  it("should merge responses", () => {
    const target = { responses: { NotFound: { description: "Not found" } } };
    const source = { responses: { Conflict: { description: "Conflict" } } };

    const result = mergeComponents(target, source);

    expect(result.responses).toEqual({
      NotFound: { description: "Not found" },
      Conflict: { description: "Conflict" },
    });
  });

  it("should merge examples", () => {
    const target = { examples: { UserSuccess: {} } };
    const source = { examples: { UserError: {} } };

    const result = mergeComponents(target, source);

    expect(result.examples).toEqual({
      UserSuccess: {},
      UserError: {},
    });
  });

  it("should handle empty target object", () => {
    const target = {};
    const source = {
      securitySchemes: { bearerAuth: { type: "http" } },
      schemas: { User: { type: "object" } },
    };

    const result = mergeComponents(target, source);

    expect(result.securitySchemes).toEqual({
      bearerAuth: { type: "http" },
    });
    expect(result.schemas).toEqual({ User: { type: "object" } });
  });

  it("should handle empty source object", () => {
    const target = {
      securitySchemes: { bearerAuth: { type: "http" } },
    };
    const source = {};

    const result = mergeComponents(target, source);

    expect(result.securitySchemes).toEqual({
      bearerAuth: { type: "http" },
    });
  });

  it("should handle unknown keys by copying them directly", () => {
    const target = {};
    const source = { tags: [{ name: "Auth" }] };

    const result = mergeComponents(target, source);

    expect(result.tags).toEqual([{ name: "Auth" }]);
  });

  it("should override target value with source for non-special keys", () => {
    const target = { tags: [{ name: "OldTag" }] };
    const source = { tags: [{ name: "NewTag" }] };

    const result = mergeComponents(target, source);

    expect(result.tags).toEqual([{ name: "NewTag" }]);
  });

  it("should deep merge when source has partial securitySchemes", () => {
    const target = {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    };
    const source = {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "cookie" },
      },
    };

    const result = mergeComponents(target, source);

    // The source completely overrides the target securityScheme entry
    // because we use spread operator { ...merged, ...value }
    expect(result.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "cookie" },
    });
  });

  it("should handle missing components in swaggerSpec during module execution", () => {
    const fs = require("fs");
    jest.isolateModules(() => {
      jest.mock("swagger-jsdoc", () => {
        return jest.fn().mockReturnValue({});
      });

      const writeFileSyncSpy = jest
        .spyOn(fs, "writeFileSync")
        .mockImplementation(() => {});

      const { mergeComponents } = require("../../utils/generateSwagger.util");

      expect(typeof mergeComponents).toBe("function");
      expect(writeFileSyncSpy).toHaveBeenCalled();

      writeFileSyncSpy.mockRestore();
    });
  });
});
