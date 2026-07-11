export function RelaunchNotice() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Open from My Apps</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This app must be launched from your N3 AI Cloud Accounting account.
        Sign in to N3, go to <span className="font-medium">My Apps</span>, and
        open <span className="font-medium">ServiceHub2</span> from there. A
        secure launch token will be provided automatically.
      </p>
    </div>
  );
}
