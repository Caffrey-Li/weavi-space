// 由 tokens/build.mjs 生成。用法：tailwind.config.ts 中 presets: [require('./docs/design/nova/tokens/tailwind.preset.cjs')]
module.exports = {
  "theme": {
    "extend": {
      "colors": {
        "nv": {
          "bg": {
            "canvas": "var(--nv-bg-canvas)",
            "surface": "var(--nv-bg-surface)",
            "raised": "var(--nv-bg-raised)",
            "sunken": "var(--nv-bg-sunken)",
            "subtle": "var(--nv-bg-subtle)",
            "hover": "var(--nv-bg-hover)",
            "pressed": "var(--nv-bg-pressed)",
            "selected": "var(--nv-bg-selected)",
            "inverse": "var(--nv-bg-inverse)",
            "scrim": "var(--nv-bg-scrim)"
          },
          "text": {
            "primary": "var(--nv-text-primary)",
            "secondary": "var(--nv-text-secondary)",
            "tertiary": "var(--nv-text-tertiary)",
            "disabled": "var(--nv-text-disabled)",
            "inverse": "var(--nv-text-inverse)",
            "link": "var(--nv-text-link)",
            "on-accent": "var(--nv-text-on-accent)"
          },
          "icon": {
            "primary": "var(--nv-icon-primary)",
            "secondary": "var(--nv-icon-secondary)"
          },
          "border": {
            "subtle": "var(--nv-border-subtle)",
            "default": "var(--nv-border-default)",
            "strong": "var(--nv-border-strong)",
            "focus": "var(--nv-border-focus)"
          },
          "accent": {
            "default": "var(--nv-accent-default)",
            "hover": "var(--nv-accent-hover)",
            "pressed": "var(--nv-accent-pressed)",
            "subtle": "var(--nv-accent-subtle)",
            "subtle-hover": "var(--nv-accent-subtle-hover)",
            "text": "var(--nv-accent-text)"
          },
          "success": {
            "fg": "var(--nv-success-fg)",
            "bg": "var(--nv-success-bg)",
            "solid": "var(--nv-success-solid)"
          },
          "warning": {
            "fg": "var(--nv-warning-fg)",
            "bg": "var(--nv-warning-bg)",
            "solid": "var(--nv-warning-solid)"
          },
          "danger": {
            "fg": "var(--nv-danger-fg)",
            "bg": "var(--nv-danger-bg)",
            "solid": "var(--nv-danger-solid)",
            "hover": "var(--nv-danger-hover)"
          },
          "info": {
            "fg": "var(--nv-info-fg)",
            "bg": "var(--nv-info-bg)"
          },
          "state": {
            "req": "var(--nv-state-req)",
            "dev": "var(--nv-state-dev)",
            "test": "var(--nv-state-test)",
            "done": "var(--nv-state-done)",
            "cancelled": "var(--nv-state-cancelled)",
            "review": "var(--nv-state-review)"
          },
          "priority": {
            "urgent": "var(--nv-priority-urgent)",
            "high": "var(--nv-priority-high)",
            "medium": "var(--nv-priority-medium)",
            "low": "var(--nv-priority-low)",
            "none": "var(--nv-priority-none)"
          },
          "role": {
            "pm": "var(--nv-role-pm)",
            "product": "var(--nv-role-product)",
            "frontend": "var(--nv-role-frontend)",
            "backend": "var(--nv-role-backend)",
            "qa": "var(--nv-role-qa)",
            "tech-lead": "var(--nv-role-tech-lead)",
            "director": "var(--nv-role-director)",
            "admin": "var(--nv-role-admin)",
            "member": "var(--nv-role-member)"
          }
        }
      },
      "fontFamily": {
        "nv": [
          "var(--nv-font-sans)"
        ],
        "nv-mono": [
          "var(--nv-font-mono)"
        ]
      },
      "fontSize": {
        "nv-display": [
          "28px",
          {
            "lineHeight": "36px",
            "fontWeight": "600",
            "letterSpacing": "-0.4px"
          }
        ],
        "nv-title-1": [
          "22px",
          {
            "lineHeight": "30px",
            "fontWeight": "600",
            "letterSpacing": "-0.2px"
          }
        ],
        "nv-title-2": [
          "18px",
          {
            "lineHeight": "26px",
            "fontWeight": "600",
            "letterSpacing": "-0.1px"
          }
        ],
        "nv-title-3": [
          "15px",
          {
            "lineHeight": "22px",
            "fontWeight": "600",
            "letterSpacing": "0px"
          }
        ],
        "nv-body-lg": [
          "14px",
          {
            "lineHeight": "22px",
            "fontWeight": "400",
            "letterSpacing": "0px"
          }
        ],
        "nv-body": [
          "13px",
          {
            "lineHeight": "20px",
            "fontWeight": "400",
            "letterSpacing": "0px"
          }
        ],
        "nv-body-strong": [
          "13px",
          {
            "lineHeight": "20px",
            "fontWeight": "500",
            "letterSpacing": "0px"
          }
        ],
        "nv-label": [
          "12px",
          {
            "lineHeight": "16px",
            "fontWeight": "500",
            "letterSpacing": "0px"
          }
        ],
        "nv-caption": [
          "12px",
          {
            "lineHeight": "16px",
            "fontWeight": "400",
            "letterSpacing": "0px"
          }
        ],
        "nv-micro": [
          "11px",
          {
            "lineHeight": "14px",
            "fontWeight": "500",
            "letterSpacing": "0.2px"
          }
        ],
        "nv-mono": [
          "12px",
          {
            "lineHeight": "16px",
            "fontWeight": "500",
            "letterSpacing": "0px"
          }
        ]
      },
      "borderRadius": {
        "nv-none": "var(--nv-radius-none)",
        "nv-xs": "var(--nv-radius-xs)",
        "nv-sm": "var(--nv-radius-sm)",
        "nv-md": "var(--nv-radius-md)",
        "nv-lg": "var(--nv-radius-lg)",
        "nv-xl": "var(--nv-radius-xl)",
        "nv-full": "var(--nv-radius-full)"
      },
      "boxShadow": {
        "nv-xs": "var(--nv-shadow-xs)",
        "nv-sm": "var(--nv-shadow-sm)",
        "nv-md": "var(--nv-shadow-md)",
        "nv-lg": "var(--nv-shadow-lg)",
        "nv-xl": "var(--nv-shadow-xl)",
        "nv-focus": "var(--nv-shadow-focus)",
        "nv-focus-danger": "var(--nv-shadow-focus-danger)"
      },
      "transitionDuration": {
        "nv-instant": "var(--nv-duration-instant)",
        "nv-fast": "var(--nv-duration-fast)",
        "nv-base": "var(--nv-duration-base)",
        "nv-slow": "var(--nv-duration-slow)",
        "nv-deliberate": "var(--nv-duration-deliberate)"
      },
      "transitionTimingFunction": {
        "nv-standard": "var(--nv-ease-standard)",
        "nv-enter": "var(--nv-ease-enter)",
        "nv-exit": "var(--nv-ease-exit)",
        "nv-spring": "var(--nv-ease-spring)"
      },
      "zIndex": {
        "nv-base": "var(--nv-z-base)",
        "nv-sticky": "var(--nv-z-sticky)",
        "nv-dropdown": "var(--nv-z-dropdown)",
        "nv-overlay": "var(--nv-z-overlay)",
        "nv-modal": "var(--nv-z-modal)",
        "nv-toast": "var(--nv-z-toast)",
        "nv-tooltip": "var(--nv-z-tooltip)"
      }
    }
  }
};
