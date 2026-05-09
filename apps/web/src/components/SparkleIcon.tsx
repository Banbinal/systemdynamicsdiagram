interface SparkleIconProps {
  readonly size?: number;
}

/**
 * Two-stars sparkle glyph used as the AI affordance across the app
 * (CodeMirror toolbar, Loops sidebar, modal headers). Stroke follows
 * `currentColor` so the parent button's colour scheme drives it.
 */
export function SparkleIcon({ size = 13 }: SparkleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 15.8l-1.8-4.6L6 9.4l4.2-1.8z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
    </svg>
  );
}
