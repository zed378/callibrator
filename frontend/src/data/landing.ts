// Landing-page content, kept in one authored module so copy + imagery are easy
// to edit and the section components stay presentational.
//
// NOTE: testimonials (people, quotes) and the headline metrics below are
// illustrative PLACEHOLDERS — see public/marketing/CREDITS.md. Replace with
// real customers and numbers before a production launch.

import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  CalendarClock,
  Gauge,
  BadgeCheck,
  ShieldCheck,
  Bell,
  Layers,
  FileText,
  Activity,
  Globe,
  Cpu,
  LineChart,
} from "lucide-react";

export interface Stat {
  value: string;
  label: string;
}

// Deliberately specific-sounding, still illustrative.
export const heroStats: Stat[] = [
  { value: "12,000+", label: "instruments under management" },
  { value: "40%", label: "less time preparing for audits" },
  { value: "99.2%", label: "calibrations completed on schedule" },
];

export interface Step {
  no: string;
  title: string;
  description: string;
  image: string;
  alt: string;
  aspect: string;
}

export const steps: Step[] = [
  {
    no: "01",
    title: "Bring your fleet into one place",
    description:
      "Scan or import every analyser, monitor, and pump into a single inventory — model, location, owner, and calibration interval on one record.",
    image: "/marketing/step-register.jpg",
    alt: "Technician entering equipment details on a touchscreen in a clean lab",
    aspect: "3 / 2",
  },
  {
    no: "02",
    title: "Let schedules run themselves",
    description:
      "Set an interval per device class and the platform raises work orders ahead of time, assigns technicians, and warns before anything drifts out of tolerance.",
    image: "/marketing/step-schedule.jpg",
    alt: "Hand marking calibration dates on a calendar beside a medical device",
    aspect: "3 / 4",
  },
  {
    no: "03",
    title: "Capture readings at the bench",
    description:
      "Technicians record measurements against traceable reference standards on any device — pass/fail is evaluated the moment values are entered.",
    image: "/marketing/step-calibrate.jpg",
    alt: "Close-up of hands adjusting a calibration instrument",
    aspect: "3 / 2",
  },
  {
    no: "04",
    title: "Sign, certify, and archive",
    description:
      "Approve results, apply a tamper-evident digital signature, and issue a certificate that's ready to hand an ISO 17025 or KARS auditor — no scramble.",
    image: "/marketing/step-certify.jpg",
    alt: "A person signing an official document with a pen",
    aspect: "3 / 4",
  },
];

export interface Feature {
  icon: LucideIcon;
  tag: string;
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    icon: ShieldCheck,
    tag: "Core",
    title: "Device lifecycle, end to end",
    description:
      "Every instrument's history — commissioning, calibrations, repairs, retirement — on one auditable timeline.",
  },
  {
    icon: CalendarClock,
    tag: "Automation",
    title: "Scheduling that stays ahead",
    description:
      "Interval-based due dates, technician assignment, and escalations before a device slips out of tolerance.",
  },
  {
    icon: BadgeCheck,
    tag: "Compliance",
    title: "Certificates auditors accept",
    description:
      "Traceable measurement chains and signed, tamper-evident certificates generated automatically.",
  },
  {
    icon: Bell,
    tag: "Alerts",
    title: "Notifications that matter",
    description:
      "Targeted reminders for due, overdue, and failed calibrations — to the people who own the device.",
  },
  {
    icon: Layers,
    tag: "Enterprise",
    title: "Multi-tenant by design",
    description:
      "Isolate facilities and regions, each with its own branding, roles, and data — from one console.",
  },
  {
    icon: LineChart,
    tag: "Analytics",
    title: "Reporting leadership reads",
    description:
      "Compliance rates, workload, and cost trends in dashboards you can export for the board.",
  },
];

export interface Capability {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const platformCapabilities: Capability[] = [
  {
    icon: FileText,
    title: "Digital certificates & records",
    description:
      "Signed PDFs and a full measurement trail, retained and searchable for the life of every device.",
  },
  {
    icon: Activity,
    title: "Real-time device status",
    description:
      "See what's due, overdue, and out of service across the whole fleet at a glance.",
  },
  {
    icon: Globe,
    title: "Multi-region ready",
    description:
      "Run several facilities or countries with data residency and per-tenant configuration.",
  },
  {
    icon: Cpu,
    title: "API-first architecture",
    description:
      "Connect your CMMS, LIS, or asset register — calibration data flows where you need it.",
  },
];

export interface Accreditation {
  code: string;
  title: string;
  description: string;
}

export const accreditations: Accreditation[] = [
  {
    code: "ISO 17025",
    title: "Testing & calibration competence",
    description: "Traceability and uncertainty handled the way assessors expect.",
  },
  {
    code: "KARS",
    title: "Hospital accreditation (ID)",
    description: "Evidence packaged for Indonesian hospital accreditation surveys.",
  },
  {
    code: "SNARS",
    title: "National accreditation standard",
    description: "Device-safety records mapped to SNARS requirements.",
  },
  {
    code: "HIPAA",
    title: "Data privacy & security",
    description: "Access controls and audit logs that protect sensitive records.",
  },
];

export const complianceChecklist: string[] = [
  "Unbroken measurement traceability chain",
  "Automatic calibration due & overdue tracking",
  "Digital certificate signing and validation",
  "Complete, immutable audit history",
  "Role-based access and approval workflows",
  "One-click export for auditors and surveys",
];

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
  avatar: string;
}

export const testimonials: Testimonial[] = [
  {
    quote:
      "We used to lose a full week to audit prep. Now the certificates are already signed and filed — I export them in an afternoon and our assessor barely has a question.",
    name: "Dr. Sarah Chen",
    role: "Chief Biomedical Engineer",
    company: "Meridian Health System",
    avatar: "/marketing/avatar-2.jpg",
  },
  {
    quote:
      "Nothing falls through the cracks anymore. The schedule tells my team what's due before it's due, and overdue devices are impossible to ignore.",
    name: "James Okafor",
    role: "Calibration Lead",
    company: "St. Aubyn Medical Center",
    avatar: "/marketing/avatar-1.jpg",
  },
  {
    quote:
      "Rolling it out across four hospitals took days, not months. Each site keeps its own data and branding but we finally report on all of it together.",
    name: "Dr. Aisha Rahman",
    role: "Director of Quality",
    company: "Northgate Hospitals",
    avatar: "/marketing/avatar-4.jpg",
  },
  {
    quote:
      "Recording readings at the bench on a tablet — and getting the pass/fail instantly — changed how our technicians actually work.",
    name: "Marco Silva",
    role: "Biomedical Technician",
    company: "Valley Regional",
    avatar: "/marketing/avatar-3.jpg",
  },
];

export const partners: string[] = [
  "Meridian Health",
  "St. Aubyn",
  "Northgate",
  "Valley Regional",
  "PrimeCare",
  "Unity Health",
];

export interface PricingTier {
  name: string;
  icon: LucideIcon;
  blurb: string;
  featured: boolean;
  cta: string;
  features: string[];
}

export const pricingTiers: PricingTier[] = [
  {
    name: "Starter",
    icon: ClipboardList,
    blurb: "For a single facility getting organised.",
    featured: false,
    cta: "Start free trial",
    features: [
      "Up to 100 devices",
      "1 facility",
      "Scheduling & reminders",
      "Digital certificates",
      "Email support",
    ],
  },
  {
    name: "Professional",
    icon: Gauge,
    blurb: "For growing teams across several sites.",
    featured: true,
    cta: "Start free trial",
    features: [
      "Up to 1,000 devices",
      "5 facilities",
      "SSO & role-based access",
      "Advanced analytics",
      "API access",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    icon: ShieldCheck,
    blurb: "For hospital networks and regions.",
    featured: false,
    cta: "Contact sales",
    features: [
      "Unlimited devices",
      "Unlimited facilities",
      "Multi-region & data residency",
      "Dedicated success manager",
      "On-premise option",
      "Custom integrations",
    ],
  },
];
