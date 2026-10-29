// Work a request starts and does not wait for. A rejection there has no caller
// to land on, so it surfaces as an unhandled rejection, which Node treats as
// fatal. Every such task is best-effort and re-attempted on its own schedule,
// so the failure is logged under the task's name and the process carries on.

export const inBackground = (task: Promise<unknown>, what: string): void => {
  task.catch((error: unknown) => console.error(`${what} failed`, error));
};
