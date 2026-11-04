import { z } from "zod";

export const AddShortlistSchema = z.object({
  listingId: z.coerce
    .number({ message: "listingId must be a valid number" })
    .int("listingId must be an integer")
    .positive("listingId must be positive"),
});

export const MergeShortlistSchema = z.object({
  listingIds: z
    .array(
      z.coerce
        .number({ message: "Each listingId must be a number" })
        .int()
        .positive()
    )
    .max(500, "Cannot merge more than 500 listings at once"),
});

export type AddShortlistInput = z.infer<typeof AddShortlistSchema>;
export type MergeShortlistInput = z.infer<typeof MergeShortlistSchema>;

