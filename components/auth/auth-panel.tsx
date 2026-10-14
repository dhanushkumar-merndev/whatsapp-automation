/** ChatGPT-style auth screen body: large centred heading, no card chrome. */
export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-2 text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Tall pill fields and buttons used across the auth screens. */
export const AUTH_INPUT = "h-[52px] rounded-full px-5 text-base md:text-base";
export const AUTH_BUTTON = "h-[52px] w-full text-base";
