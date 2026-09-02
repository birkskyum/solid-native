import { createElement, useState } from "react";
import {
  AppRegistry,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type OrderPhase = "active" | "queued" | "settled";

const MODULE_NAME = "SolidNativeReactControl";
const orders = [
  { id: "ORD-1001", customer: "Aster Labs", amount: "$148" },
  { id: "ORD-1002", customer: "Northstar", amount: "$86" },
  { id: "ORD-1003", customer: "Cinder Co", amount: "$212" },
  { id: "ORD-1004", customer: "Mesa Goods", amount: "$64" },
  { id: "ORD-1005", customer: "Juniper", amount: "$173" },
  { id: "ORD-1006", customer: "Riverline", amount: "$95" },
  { id: "ORD-1007", customer: "Atlas House", amount: "$131" },
  { id: "ORD-1008", customer: "Beacon", amount: "$118" },
  { id: "ORD-1009", customer: "Fable Works", amount: "$77" },
  { id: "ORD-1010", customer: "Orbit Supply", amount: "$204" },
  { id: "ORD-1011", customer: "Pine Studio", amount: "$59" },
  { id: "ORD-1012", customer: "Willow Market", amount: "$162" },
] as const;

interface WorkloadState {
  readonly processed: number;
  readonly activeIndex: number;
  readonly phases: readonly OrderPhase[];
}

const initialState: WorkloadState = {
  processed: 1,
  activeIndex: 0,
  phases: orders.map((_, index) => (index === 0 ? "active" : "queued")),
};

function ReactProductWorkload() {
  const [state, setState] = useState(initialState);
  const advance = (): void => {
    setState((current) => {
      const nextIndex = (current.activeIndex + 1) % orders.length;
      return {
        processed: current.processed + 1,
        activeIndex: nextIndex,
        phases: current.phases.map((phase, index) =>
          index === current.activeIndex
            ? "settled"
            : index === nextIndex
              ? "active"
              : phase,
        ),
      };
    });
  };

  return createElement(
    View,
    { style: styles.screen, testID: "product-workload-root" },
    createElement(
      Text,
      { accessibilityRole: "header", style: styles.title },
      "Fulfillment overview",
    ),
    createElement(
      View,
      { style: styles.summaryRow },
      createElement(
        View,
        { style: styles.summaryCard },
        createElement(Text, { style: styles.summaryLabel }, "Processed"),
        createElement(
          Text,
          { style: styles.summaryValue },
          `Orders processed ${String(state.processed)}`,
        ),
      ),
      createElement(
        View,
        { style: styles.summaryCard },
        createElement(Text, { style: styles.summaryLabel }, "Active"),
        createElement(
          Text,
          { style: styles.summaryValue },
          `Active order ${orders[state.activeIndex]?.id}`,
        ),
      ),
    ),
    createElement(
      View,
      { style: styles.progressTrack },
      createElement(View, {
        style: [
          styles.progressFill,
          { width: (state.processed % 10 || 10) * 24 },
        ],
      }),
    ),
    state.processed % 5 === 0
      ? createElement(
          View,
          { style: styles.alert },
          createElement(
            Text,
            { style: styles.alertText },
            "Priority reconciliation required",
          ),
        )
      : null,
    createElement(
      Pressable,
      {
        accessibilityLabel: "Advance fulfillment workload",
        accessibilityRole: "button",
        onPress: advance,
        style: styles.button,
      },
      createElement(Text, { style: styles.buttonText }, "Process next order"),
    ),
    createElement(Text, { style: styles.sectionTitle }, "Live order queue"),
    createElement(
      ScrollView,
      { style: styles.list },
      ...orders.map((order, index) => {
        const phase = state.phases[index];
        return createElement(
          View,
          {
            accessibilityLabel: `Order ${order.id} ${phase}`,
            accessible: true,
            key: order.id,
            style: [
              styles.orderRow,
              phase === "active"
                ? styles.activeOrder
                : phase === "settled"
                  ? styles.settledOrder
                  : styles.queuedOrder,
            ],
          },
          createElement(
            View,
            { style: styles.orderIdentity },
            createElement(Text, { style: styles.orderId }, order.id),
            createElement(Text, { style: styles.customer }, order.customer),
          ),
          createElement(
            View,
            { style: styles.orderMeta },
            createElement(Text, { style: styles.amount }, order.amount),
            createElement(Text, { style: styles.phase }, phase),
          ),
        );
      }),
    ),
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#f4f7fb",
    flex: 1,
    padding: 18,
  },
  title: {
    color: "#14213d",
    fontSize: 25,
    fontWeight: "700",
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    flex: 1,
    marginRight: 8,
    padding: 10,
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: 12,
  },
  summaryValue: {
    color: "#14213d",
    fontSize: 15,
    fontWeight: "600",
  },
  progressTrack: {
    backgroundColor: "#dbe4f0",
    height: 6,
    marginBottom: 8,
  },
  progressFill: {
    backgroundColor: "#2563eb",
    height: 6,
  },
  alert: {
    backgroundColor: "#fff1c2",
    marginBottom: 8,
    padding: 8,
  },
  alertText: {
    color: "#7c4a03",
    fontSize: 13,
    fontWeight: "600",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    marginBottom: 10,
    paddingVertical: 11,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  sectionTitle: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  list: {
    flex: 1,
  },
  orderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  activeOrder: {
    backgroundColor: "#dbeafe",
  },
  queuedOrder: {
    backgroundColor: "#ffffff",
  },
  settledOrder: {
    backgroundColor: "#e8f7ee",
  },
  orderIdentity: {
    flex: 1,
  },
  orderMeta: {
    alignItems: "flex-end",
  },
  orderId: {
    color: "#1e293b",
    fontSize: 13,
    fontWeight: "600",
  },
  customer: {
    color: "#64748b",
    fontSize: 12,
  },
  amount: {
    color: "#1e293b",
    fontSize: 13,
    fontWeight: "600",
  },
  phase: {
    color: "#64748b",
    fontSize: 11,
  },
});

AppRegistry.registerComponent(MODULE_NAME, () => ReactProductWorkload);
