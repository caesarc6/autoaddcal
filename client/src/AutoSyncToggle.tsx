import { useEffect, useState } from "react";
import { SwitchDisclosure } from "./components/original/switch-disclosure";

export interface AutoSyncToggleProps {
  initialEnabled: boolean;
  disabled?: boolean;
}

export function AutoSyncToggle({
  initialEnabled,
  disabled = false,
}: AutoSyncToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  async function persist(next: boolean) {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/users/me/auto-sync", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save auto-sync setting");
      }

      setEnabled(data.enabled);
      setMessage(
        data.enabled
          ? "Auto sync is on for Thursdays."
          : "Manual sync only — use Sync now when you want to update.",
      );
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : "Failed to save setting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`space-y-3 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <SwitchDisclosure
        title="Auto Sync"
        showSubOption={false}
        enabled={enabled}
        onToggleChange={(next) => {
          if (saving) return;
          setEnabled(next);
          void persist(next);
        }}
      />
      {message ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
