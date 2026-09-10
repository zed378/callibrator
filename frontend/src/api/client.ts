import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from "axios";
import { API_TIMEOUT } from "@/constants";

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: "", // Send requests to current Next.js origin for proxying
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
  },
});

// NOTE: The Authorization header is injected server-side by the API proxy
// (src/app/api/v1/[...path]/route.ts) from the httpOnly auth_token cookie.
// The JWT is deliberately never read from localStorage on the client, so it
// cannot be exfiltrated via XSS.

// Request interceptor: for multipart uploads (FormData bodies), remove the
// default `application/json` Content-Type so the browser sets
// `multipart/form-data; boundary=...` itself. Setting the Content-Type
// manually strips the boundary and makes the backend's multer unable to parse
// the body (uploads silently fail with "field required").
apiClient.interceptors.request.use(
  (config) => {
    if (typeof FormData !== "undefined" && config.data instanceof FormData) {
      if (config.headers) {
        delete (config.headers as Record<string, unknown>)["Content-Type"];
        delete (config.headers as Record<string, unknown>)["content-type"];
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor - handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Extract error message from response body if available
    const responseData = error.response?.data as
      | { message?: string; error?: string }
      | undefined;
    const errorMessage =
      responseData?.message || responseData?.error || error.message;

    if (error.response?.status === 401) {
      // Token expired or invalid - redirect to login. The httpOnly auth
      // cookies are cleared server-side on logout/verify failure.
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }

    // Attach the detailed error message to the error object
    if (
      error instanceof Error &&
      errorMessage &&
      errorMessage !== error.message
    ) {
      error.message = errorMessage;
    }

    return Promise.reject(error);
  },
);

// API methods with generic type support
export const api = {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.get(url, config).then((res) => res.data),

  post: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => apiClient.post(url, data, config).then((res) => res.data),

  put: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => apiClient.put(url, data, config).then((res) => res.data),

  patch: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => apiClient.patch(url, data, config).then((res) => res.data),

  delete: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.delete(url, config).then((res) => res.data),
};

export default apiClient;
