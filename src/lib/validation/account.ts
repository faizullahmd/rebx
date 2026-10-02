import { z } from "zod";
import { PasswordSchema } from "@/lib/validation/auth";
import { validateUsernameFormat } from "@/lib/validation/username";

export const ProfileFormSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters long."),
    email: z.string().trim().email("Please enter a valid email."),
    username: z.string().trim().optional().or(z.literal("")),
    agencyName: z.string().trim().optional().or(z.literal("")),
    licenseNo: z.string().trim().optional().or(z.literal("")),
    companyName: z.string().trim().optional().or(z.literal("")),
    website: z.string().trim().optional().or(z.literal("")),
    phone: z.string().trim().optional().or(z.literal("")),
    bio: z.string().trim().optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.username) {
      const check = validateUsernameFormat(data.username);
      if (!check.valid && check.error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["username"],
          message: check.error,
        });
      }
    }
  });

export type ProfileFormState =
  | {
      errors?: Partial<Record<keyof z.infer<typeof ProfileFormSchema>, string[]>>;
      message?: string;
    }
  | undefined;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: PasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type ChangePasswordState =
  | {
      errors?: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string[]>>;
      message?: string;
    }
  | undefined;

export const ForgotPasswordSchema = z.object({
  email: z.string().trim().email("Please enter a valid email."),
});

export type ForgotPasswordState =
  | {
      message?: string;
    }
  | undefined;

export const ResetPasswordSchema = z
  .object({
    newPassword: PasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type ResetPasswordState =
  | {
      errors?: Partial<Record<"newPassword" | "confirmPassword", string[]>>;
      message?: string;
    }
  | undefined;
