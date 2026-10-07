import { NavLink } from "react-router-dom";
import { Home, Users, Inbox, MessageCircle, User, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

interface TabBarProps {
  inboxCount: number;
  messagesCount: number;
  /** No office exists for a company-less account — omit Messages entirely
   *  rather than showing it disabled, and show Billing in its place since
   *  this role pays Izaya directly instead of a company handling it. */
  isIndependentPractitioner: boolean;
}

const BASE_TABS = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/roster", label: "Children", icon: Users },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/profile", label: "Profile", icon: User },
];

const INDEPENDENT_TABS = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/roster", label: "Children", icon: Users },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/profile", label: "Profile", icon: User },
];

// Bottom tab bar — solid surface + 1px top hairline (never glassmorphism),
// >= 56x48px targets, safe-area-inset-bottom padding. Tab switches never
// animate (Kowalski: used hundreds of times/day) — only the active
// indicator's position transitions. Art-direction §5.
export function TabBar({ inboxCount, messagesCount, isIndependentPractitioner }: TabBarProps) {
  const TABS = isIndependentPractitioner ? INDEPENDENT_TABS : BASE_TABS;
  return (
    <nav
      aria-label="Primary"
      className="safe-bottom sticky bottom-0 z-40 border-t border-border bg-surface shadow-[var(--elev-raised)]"
    >
      {/* Both TABS variants are exactly 5 entries (Messages swapped for
          Billing, not removed) so this stays a static, JIT-safe class —
          a template-literal grid-cols-${n} class would not be picked up
          by Tailwind's build-time content scan. */}
      <ul className="grid grid-cols-5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  "press-scale relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium",
                  isActive ? "text-primary" : "text-ink-muted"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary transition-all duration-[180ms] ease-[var(--ease-in-out)]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative">
                    <Icon className="size-6" strokeWidth={2} aria-hidden="true" />
                    {to === "/inbox" && inboxCount > 0 && (
                      <span className="tabular absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                        {inboxCount > 99 ? "99+" : inboxCount}
                      </span>
                    )}
                    {to === "/messages" && messagesCount > 0 && (
                      <span className="tabular absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                        {messagesCount > 99 ? "99+" : messagesCount}
                      </span>
                    )}
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
