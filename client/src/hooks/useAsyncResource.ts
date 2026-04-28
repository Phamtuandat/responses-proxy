import { useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: Error };

export function useAsyncResource<T>(loader: () => Promise<T>) {
  const mountedRef = useRef(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  useEffect(() => {
    mountedRef.current = true;
    setState({ status: "loading" });

    void loader()
      .then((data) => {
        if (mountedRef.current) {
          setState({ status: "success", data });
        }
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error("Request failed"),
          });
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [loader, reloadToken]);

  return {
    state,
    retry() {
      setReloadToken((value) => value + 1);
    },
  };
}
