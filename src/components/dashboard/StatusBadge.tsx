export function StatusBadge({
  status,
  size = "md",
}: {
  status: string;
  size?: "sm" | "md";
}) {
  const styles: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-700",
    ACTIVE: "bg-green-100 text-green-700",
    UNDER_OFFER: "bg-amber-100 text-amber-700",
    SOLD: "bg-blue-100 text-blue-700",
  };

  const sizeClasses =
    size === "sm"
      ? "px-1.5 py-0.5 text-[10px]"
      : "px-2.5 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex rounded-full font-medium whitespace-nowrap ${sizeClasses} ${
        styles[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
