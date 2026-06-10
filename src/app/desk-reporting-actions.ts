"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  writeBookingMetric,
  recomputeRequestStatus,
  sendMetricsRequestStep,
} from "@/lib/campaign-reporting/campaign";

// These actions are bound with .bind() from client components rather
// than posted as forms, so they throw on auth failure instead of
// redirecting — the caller surfaces the error.

export async function saveFlightWindow(orderId: string, fd: FormData) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    throw new Error("forbidden");
  }
  const userId = session.user.id;
  const start = String(fd.get("flightStartDate") ?? "").trim();
  const end = String(fd.get("flightEndDate") ?? "").trim();
  await prisma.order.update({
    where: { id: orderId },
    data: {
      flightStartDate: start ? new Date(start) : null,
      flightEndDate: end ? new Date(end) : null,
    },
  });
  await recordAudit(userId, "order.flight_window.save", `Order:${orderId}`, { start, end });
  revalidatePath(`/desk/orders/${orderId}`);
}

export async function saveBookingMetricOverride(bookingId: string, fd: FormData) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    throw new Error("forbidden");
  }
  const userId = session.user.id;
  const num = (k: string): number | null => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? null : /^\d+$/.test(v) ? Number(v) : null;
  };
  await writeBookingMetric({
    bookingId,
    source: "DESK",
    reportedBy: userId,
    fields: {
      impressions: num("impressions"),
      pageViews: num("pageViews"),
      publisherReportedClicks: num("clicks"),
      avgTimeSec: num("avgTimeSec"),
      scrollDepthPct: num("scrollDepthPct"),
    },
  });
  const rb = await prisma.metricsRequestBooking.findFirst({
    where: { bookingId },
    select: { metricsRequestId: true },
  });
  if (rb) await recomputeRequestStatus(rb.metricsRequestId);
  // Resolve orderId from the booking chain so we can invalidate the right path.
  const booking = await prisma.publisherBooking.findUnique({
    where: { id: bookingId },
    select: { orderLine: { select: { orderId: true } } },
  });
  if (booking?.orderLine.orderId) {
    revalidatePath(`/desk/orders/${booking.orderLine.orderId}`);
  }
}

export async function resendMetricsRequest(requestId: string) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    throw new Error("forbidden");
  }
  await sendMetricsRequestStep({ requestId, actorId: session.user.id });
}
