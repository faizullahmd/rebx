export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends Error {
  constructor(message = "Template not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
export class ValidationFailure extends Error {
  constructor(
    public fieldErrors: Record<string, string[]>,
    message = "Please fix the highlighted fields."
  ) {
    super(message);
    this.name = "ValidationFailure";
  }
}
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}
