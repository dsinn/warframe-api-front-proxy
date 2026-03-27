import { vi } from "vitest";

/**
 * Lightweight fetchMock shim using vi.spyOn(globalThis, 'fetch').
 *
 * Implements the subset of the undici MockAgent API used by these tests:
 *   fetchMock.activate() / deactivate()
 *   fetchMock.disableNetConnect()
 *   fetchMock.assertNoPendingInterceptors()
 *   fetchMock.get(origin).intercept(opts).reply(status, body[, { headers }])
 *   fetchMock.get(origin).intercept(opts).replyWithError(error)
 */

class MockScope {
  constructor(interceptor) {
    this._interceptor = interceptor;
  }
  persist() {
    this._interceptor.persist = true;
    return this;
  }
  times(n) {
    this._interceptor.times = n;
    return this;
  }
  delay() {
    return this;
  }
}

class MockInterceptor {
  constructor(origin, opts, interceptors) {
    this._origin = origin;
    this._opts = opts;
    this._interceptors = interceptors;
    this.persist = false;
    this.times = 1;
    this._consumed = 0;
    this._handler = null;
  }

  reply(statusCode, data, responseOptions = {}) {
    this._handler = { type: "reply", statusCode, data, responseOptions };
    this._interceptors.push(this);
    return new MockScope(this);
  }

  replyWithError(error) {
    this._handler = { type: "error", error };
    this._interceptors.push(this);
    return new MockScope(this);
  }

  matches(url, method, headers) {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (origin !== this._origin) return false;

    const { path: pathOpt, method: methodOpt, query, headers: headersOpt } = this._opts;

    // Check path (ignoring query string)
    const pathname = parsed.pathname;
    if (typeof pathOpt === "string" && pathname !== pathOpt) return false;
    if (pathOpt instanceof RegExp && !pathOpt.test(pathname)) return false;

    // Check query params
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (parsed.searchParams.get(k) !== String(v)) return false;
      }
    }

    // Check method
    if (methodOpt !== undefined) {
      const m = typeof methodOpt === "string" ? methodOpt.toUpperCase() : methodOpt;
      if (typeof m === "string" && method.toUpperCase() !== m) return false;
      if (m instanceof RegExp && !m.test(method)) return false;
    }

    // Check headers
    if (headersOpt && typeof headersOpt === "object" && !Array.isArray(headersOpt)) {
      for (const [k, v] of Object.entries(headersOpt)) {
        const actual = headers[k.toLowerCase()] ?? headers[k];
        if (typeof v === "string" && actual !== v) return false;
        if (v instanceof RegExp && (actual === undefined || !v.test(actual))) return false;
      }
    }

    return true;
  }

  isPending() {
    if (this.persist) return false;
    return this._consumed < this.times;
  }
}

class MockClient {
  constructor(origin, interceptors) {
    this._origin = origin;
    this._interceptors = interceptors;
  }

  intercept(opts) {
    return new MockInterceptor(this._origin, opts, this._interceptors);
  }
}

class FetchMock {
  constructor() {
    this._interceptors = [];
    this._networkDisabled = false;
    this._spy = null;
  }

  activate() {
    this._interceptors = [];
    this._networkDisabled = false;
    this._spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input.method : undefined) ?? "GET";
      const headers = {};
      const rawHeaders = init?.headers ?? (typeof input === "object" && !(input instanceof URL) ? input.headers : undefined);
      if (rawHeaders) {
        if (rawHeaders instanceof Headers) {
          rawHeaders.forEach((v, k) => { headers[k.toLowerCase()] = v; });
        } else if (Array.isArray(rawHeaders)) {
          rawHeaders.forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
        } else {
          Object.entries(rawHeaders).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
        }
      }

      for (const interceptor of this._interceptors) {
        if (!interceptor.isPending()) continue;
        if (!interceptor.matches(url, method, headers)) continue;

        interceptor._consumed++;
        const handler = interceptor._handler;

        if (handler.type === "error") {
          throw typeof handler.error === "string" ? new Error(handler.error) : handler.error;
        }

        const { statusCode, data, responseOptions } = handler;
        const body = typeof data === "string" ? data : data === undefined ? null : JSON.stringify(data);
        const respHeaders = new Headers();
        if (responseOptions?.headers) {
          for (const [k, v] of Object.entries(responseOptions.headers)) {
            if (v !== undefined) {
              const values = Array.isArray(v) ? v : [v];
              values.forEach(val => respHeaders.append(k, val));
            }
          }
        }
        return new Response(body, { status: statusCode, headers: respHeaders });
      }

      if (this._networkDisabled) {
        throw new Error(`fetch: request to ${url} was not mocked. Call fetchMock.get(...).intercept(...).reply(...) to set up a mock.`);
      }

      // Pass through to the real fetch if networking is enabled
      return fetch(url, init);
    });
  }

  deactivate() {
    if (this._spy) {
      this._spy.mockRestore();
      this._spy = null;
    }
    this._interceptors = [];
    this._networkDisabled = false;
  }

  disableNetConnect() {
    this._networkDisabled = true;
  }

  assertNoPendingInterceptors() {
    const pending = this._interceptors.filter(i => i.isPending());
    if (pending.length > 0) {
      const descriptions = pending.map(i => `  ${i._opts.method ?? "GET"} ${i._origin}${i._opts.path}`).join("\n");
      throw new Error(`Found pending interceptors that were not used:\n${descriptions}`);
    }
  }

  get(origin) {
    return new MockClient(origin, this._interceptors);
  }
}

export const fetchMock = new FetchMock();
