"use client";

// Does "Recently deleted" exist on this database (migration 20261005000002_trash_and_atomic_ops applied)?
// null while unknown. Delete confirmations use it to say either "moves to
// Recently deleted" or, on a database without the migration, "can't be undone".

import { useEffect, useState } from "react";
import { listDeletedItems } from "./trashData";

export function useTrashAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listDeletedItems().then((r) => {
      if (!cancelled) setAvailable(r.available);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}
