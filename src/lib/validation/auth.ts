import { z } from "zod";
import { validateUsernameFormat } from "@/lib/validation/username";

export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long.")
  .regex(/[a-zA-Z]/, "Password must contain at least one letter.")
  .regex(/[0-9]/, "Password must contain at least one number.");

export const SignupFormSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters long."),
    email: z.string().trim().email("Please enter a valid email."),
    password: PasswordSchema,
    role: z.enum(["AGENT", "CUSTOMER", "DEVELOPER"]),
    username: z.string().trim().optional().or(z.literal("")),
    companyName: z.string().trim().optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.role === "AGENT" || data.role === "DEVELOPER") {
      if (!data.username) {
        ctx.addIssue({
          code: "custom",
          path: ["username"],
          message: "Username is required for public portfolio.",
        });
      } else {
        const formatCheck = validateUsernameFormat(data.username);
        if (!formatCheck.valid) {
          ctx.addIssue({
            code: "custom",
            path: ["username"],
            message: formatCheck.error || "Invalid username.",
          });
        }
      }
    }

    if (data.role === "DEVELOPER" && !data.companyName) {
      ctx.addIssue({
        code: "custom",
        path: ["companyName"],
        message: "Company name is required.",
      });
    }
  });

export type SignupFormState =
  | {
      errors?: {
        name?: string[];
        email?: string[];
        password?: string[];
        role?: string[];
        username?: string[];
        companyName?: string[];
      };
      message?: string;
    }
  | undefined;

export const LoginFormSchema = z.object({
  email: z.string().trim().email("Please enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

export type LoginFormState =
  | {
      message?: string;
    }
  | undefined;
