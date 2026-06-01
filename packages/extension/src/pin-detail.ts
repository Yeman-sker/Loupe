import type { Annotation } from "@loupe-server/shared";

export type PinDetailActionId = "copy_markdown" | "resolve" | "delete";

export type PinDetailStatusTone = "neutral" | "success" | "warning" | "danger" | "pending";

export type PinDetailStatusViewModel = {
  state: string;
  label: string;
  icon: string;
  tone: PinDetailStatusTone;
  class_name: string;
};

export type PinDetailActionViewModel = {
  id: PinDetailActionId;
  label: string;
  enabled: boolean;
};

export type PinDetailViewModel = {
  id: string;
  display_number: string;
  task_status: PinDetailStatusViewModel;
  locator_status: PinDetailStatusViewModel;
  confidence_text: string;
  comment: string;
  selector_preview: string;
  sync_status: PinDetailStatusViewModel;
  retry_available: boolean;
  copy_fallback_available: boolean;
  actions: PinDetailActionViewModel[];
};

export function build_pin_detail_view_model(mark: Annotation, index: number): PinDetailViewModel {
  return {
    id: mark.id,
    display_number: format_display_number(index),
    task_status: task_status_view_model(mark.lifecycle.task_status),
    locator_status: locator_status_view_model(mark.target.resolution.locator_status),
    confidence_text: format_confidence(mark.target.resolution.confidence),
    comment: mark.intent.comment,
    selector_preview: mark.context.element.selector_preview,
    sync_status: sync_status_view_model(mark.sync.status),
    retry_available: mark.sync.status === "failed",
    copy_fallback_available: mark.sync.status === "failed" || mark.sync.status === "local_only",
    actions: [
      { id: "copy_markdown", label: "Copy Markdown", enabled: true },
      { id: "resolve", label: "Resolve", enabled: mark.lifecycle.task_status === "open" },
      { id: "delete", label: "Delete", enabled: true },
    ],
  };
}

function format_display_number(index: number): string {
  return String(index + 1);
}

function format_confidence(confidence: number): string {
  return `${Math.round(clamp_unit(confidence) * 100)}% confidence`;
}

function clamp_unit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function task_status_view_model(status: Annotation["lifecycle"]["task_status"]): PinDetailStatusViewModel {
  switch (status) {
    case "open":
      return status_view_model(status, "Open task", "circle", "warning", "pin-detail__status--task-open");
    case "resolved":
      return status_view_model(status, "Resolved task", "check", "success", "pin-detail__status--task-resolved");
    case "archived":
      return status_view_model(status, "Archived task", "archive", "neutral", "pin-detail__status--task-archived");
  }
}

function locator_status_view_model(status: Annotation["target"]["resolution"]["locator_status"]): PinDetailStatusViewModel {
  switch (status) {
    case "resolved":
      return status_view_model(status, "Locator resolved", "target", "success", "pin-detail__status--locator-resolved");
    case "drifted":
      return status_view_model(status, "Locator drifted", "adjust", "warning", "pin-detail__status--locator-drifted");
    case "lost":
      return status_view_model(status, "Locator lost", "missing", "danger", "pin-detail__status--locator-lost");
  }
}

function sync_status_view_model(status: Annotation["sync"]["status"]): PinDetailStatusViewModel {
  switch (status) {
    case "local_only":
      return status_view_model(status, "Local only", "device", "neutral", "pin-detail__status--sync-local-only");
    case "syncing":
      return status_view_model(status, "Syncing", "sync", "pending", "pin-detail__status--sync-syncing");
    case "synced":
      return status_view_model(status, "Synced", "cloud-check", "success", "pin-detail__status--sync-synced");
    case "failed":
      return status_view_model(status, "Sync failed", "warning", "danger", "pin-detail__status--sync-failed");
    case "delete_pending":
      return status_view_model(status, "Delete pending", "trash-clock", "pending", "pin-detail__status--sync-delete-pending");
  }
}

function status_view_model(state: string, label: string, icon: string, tone: PinDetailStatusTone, class_name: string): PinDetailStatusViewModel {
  return { state, label, icon, tone, class_name };
}
