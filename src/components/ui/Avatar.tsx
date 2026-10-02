const COLORS = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
];

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return initials.toUpperCase();
}

function colorFor(name: string) {
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return COLORS[hash % COLORS.length];
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const dimension =
    size === "sm"
      ? "h-9 w-9 text-xs"
      : size === "lg"
        ? "h-14 w-14 text-base sm:h-16 sm:w-16 sm:text-lg"
        : size === "xl"
          ? "h-16 w-16 text-lg sm:h-20 sm:w-20 sm:text-xl"
          : "h-12 w-12 text-sm";
  return (
    <div
      className={`flex ${dimension} flex-none items-center justify-center rounded-full font-semibold text-white shadow-2xs ${colorFor(name)}`}
    >
      {initialsFor(name)}
    </div>
  );
}
