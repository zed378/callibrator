import { useToastStore } from "../toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    // Reset state before each test
    useToastStore.setState({ toasts: [] });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should initialize with empty toasts array", () => {
    const state = useToastStore.getState();
    expect(state.toasts).toEqual([]);
  });

  it("should add a toast", () => {
    useToastStore.getState().addToast({
      type: "success",
      title: "Test Success",
      description: "This is a test description",
    });

    const state = useToastStore.getState();
    expect(state.toasts.length).toBe(1);
    expect(state.toasts[0]).toEqual(
      expect.objectContaining({
        type: "success",
        title: "Test Success",
        description: "This is a test description",
      })
    );
  });

  it("should remove a toast by id", () => {
    useToastStore.getState().addToast({
      type: "error",
      title: "Test Error",
    });

    let state = useToastStore.getState();
    const id = state.toasts[0].id;

    useToastStore.getState().removeToast(id);
    state = useToastStore.getState();
    expect(state.toasts).toEqual([]);
  });

  it("should auto-dismiss a toast after duration", () => {
    useToastStore.getState().addToast({
      type: "info",
      title: "Test Auto-Dismiss",
      duration: 3000,
    });

    let state = useToastStore.getState();
    expect(state.toasts.length).toBe(1);

    // Fast-forward time by 3000ms
    jest.advanceTimersByTime(3000);

    state = useToastStore.getState();
    expect(state.toasts.length).toBe(0);
  });
});
