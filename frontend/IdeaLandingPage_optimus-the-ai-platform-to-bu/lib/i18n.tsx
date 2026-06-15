"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type Language = "en" | "es";

type Translations = typeof translations;

export const translations = {
  en: {
    nav: {
      links: {
        features: "Features",
        howItWorks: "How it works",
        developers: "Developers",
        pricing: "Pricing",
      },
      signIn: "Sign in",
      startCreating: "Start creating",
      toggleMenu: "Toggle menu",
    },
    hero: {
      eyebrow: "The platform for modern teams",
      titleLine1: "The platform",
      titleTo: "to",
      rotatingWords: ["create", "build", "scale", "ship"],
      description:
        "Your toolkit to stop configuring and start innovating. Securely build, deploy, and scale the best experiences.",
      startTrial: "Start free trial",
      watchDemo: "Watch demo",
      stats: [
        { value: "20 days", label: "saved on builds", company: "NETFLIX" },
        { value: "98%", label: "faster deployment", company: "STRIPE" },
        { value: "300%", label: "throughput increase", company: "LINEAR" },
        { value: "6x", label: "faster to ship", company: "NOTION" },
      ],
    },
    features: {
      eyebrow: "Capabilities",
      titleLine1: "Everything you need.",
      titleLine2: "Nothing you don't.",
      items: [
        {
          title: "Instant Deployment",
          description:
            "Push to production in seconds. Our edge network ensures your applications load instantly, anywhere in the world.",
        },
        {
          title: "AI-Native Workflows",
          description:
            "Build intelligent applications with built-in AI capabilities. From inference to training, everything scales automatically.",
        },
        {
          title: "Real-time Collaboration",
          description:
            "Work together seamlessly. Live preview, instant feedback, and version control that actually makes sense.",
        },
        {
          title: "Enterprise Security",
          description:
            "Bank-grade encryption, SOC 2 compliance, and granular access controls. Your data stays yours.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "Process",
      titleLine1: "Three steps.",
      titleLine2: "Infinite possibilities.",
      ready: "Ready",
      fileName: "workflow.ts",
      steps: [
        {
          title: "Connect your tools",
          description:
            "Integrate with your existing stack in minutes. We support 200+ data sources out of the box.",
        },
        {
          title: "Build your workflow",
          description:
            "Design powerful automations with our visual builder or write code directly.",
        },
        {
          title: "Ship to production",
          description:
            "Deploy globally with zero configuration. Your app goes live in under 30 seconds.",
        },
      ],
    },
    infrastructure: {
      eyebrow: "Infrastructure",
      titleLine1: "Global by",
      titleLine2: "default.",
      description:
        "Deploy once, run everywhere. Our edge network spans 17 data centers across 6 continents, delivering sub-50ms latency to 99% of the world.",
      stats: {
        dataCenters: "Data centers",
        uptime: "Uptime SLA",
        latency: "Global latency",
      },
      edgeNetwork: "Edge Network",
      allOperational: "All operational",
      regions: {
        usWest: "US West",
        usEast: "US East",
        europe: "Europe",
        asiaPacific: "Asia Pacific",
        oceania: "Oceania",
        southAmerica: "South America",
      },
    },
    metrics: {
      eyebrow: "Live metrics",
      titleLine1: "Performance you",
      titleLine2: "can measure.",
      live: "Live",
      items: [
        "API requests today",
        "Uptime this quarter",
        "Average response time",
        "Countries served",
      ],
    },
    integrations: {
      eyebrow: "Integrations",
      titleLine1: "Works with everything",
      titleLine2: "you already use.",
      description:
        "200+ pre-built integrations. Connect your entire stack in minutes.",
      categories: {
        versionControl: "Version Control",
        communication: "Communication",
        payments: "Payments",
        database: "Database",
        cache: "Cache",
        cloud: "Cloud",
        hosting: "Hosting",
        design: "Design",
        projectManagement: "Project Management",
        documentation: "Documentation",
        aiml: "AI/ML",
      },
    },
    security: {
      eyebrow: "Security",
      titleLine1: "Trust is",
      titleLine2: "non-negotiable.",
      description:
        "Enterprise-grade security isn't optional. It's built into every layer of our platform, from infrastructure to application.",
      features: [
        {
          title: "SOC 2 Type II",
          description:
            "Independently audited security controls with continuous monitoring.",
        },
        {
          title: "End-to-end encryption",
          description:
            "AES-256 encryption for data at rest and TLS 1.3 in transit.",
        },
        {
          title: "Zero-trust architecture",
          description:
            "Every request is authenticated and authorized. No exceptions.",
        },
        {
          title: "GDPR & HIPAA",
          description:
            "Full compliance with data protection and healthcare regulations.",
        },
      ],
    },
    developers: {
      eyebrow: "For developers",
      titleLine1: "Built by devs.",
      titleLine2: "For devs.",
      description:
        "A thoughtfully designed SDK that gets out of your way. Ship faster with intuitive APIs and exceptional documentation.",
      tabs: {
        install: "Install",
        initialize: "Initialize",
        deploy: "Deploy",
      },
      copyCode: "Copy code",
      readDocs: "Read the docs",
      viewGitHub: "View on GitHub",
      features: [
        {
          title: "TypeScript native",
          description: "Full type safety with auto-generated types.",
        },
        {
          title: "Zero config",
          description: "Sensible defaults that just work.",
        },
        {
          title: "Edge-ready",
          description: "Runs anywhere: Node, Deno, Bun, browsers.",
        },
        {
          title: "12KB gzipped",
          description: "Lightweight with zero dependencies.",
        },
      ],
    },
    testimonials: {
      label: "What people say",
      keyResult: "Key Result",
      trustedBy: "Trusted by forward-thinking teams",
      items: [
        {
          quote:
            "Optimus transformed our deployment pipeline. What used to take hours now happens in seconds.",
          role: "CTO",
          metric: "10x faster deployments",
        },
        {
          quote:
            "The developer experience is unmatched. Our team's productivity has never been higher.",
          role: "Engineering Lead",
          metric: "40% more features shipped",
        },
        {
          quote:
            "Finally, infrastructure that scales with our ambition. Zero downtime since we switched.",
          role: "VP Engineering",
          metric: "99.99% uptime",
        },
        {
          quote:
            "The integrations are seamless. We connected our entire stack in a single afternoon.",
          role: "Founder",
          metric: "50+ integrations used",
        },
      ],
    },
    pricing: {
      eyebrow: "Pricing",
      titleLine1: "Simple, transparent",
      titleLine2: "pricing",
      description:
        "Start free and scale as you grow. No hidden fees, no surprises.",
      monthly: "Monthly",
      annual: "Annual",
      save: "Save 17%",
      mostPopular: "Most Popular",
      perMonth: "/month",
      custom: "Custom",
      bottomNote: "All plans include automatic updates, HTTPS, and DDoS protection.",
      compareFeatures: "Compare all features",
      plans: [
        {
          name: "Starter",
          description: "For individuals and small projects",
          features: [
            "Up to 3 projects",
            "1GB storage",
            "Community support",
            "Basic analytics",
            "SSL certificates",
          ],
          cta: "Start free",
        },
        {
          name: "Pro",
          description: "For growing teams and businesses",
          features: [
            "Unlimited projects",
            "100GB storage",
            "Priority support",
            "Advanced analytics",
            "Custom domains",
            "Team collaboration",
            "API access",
          ],
          cta: "Start trial",
        },
        {
          name: "Enterprise",
          description: "For large-scale operations",
          features: [
            "Everything in Pro",
            "Unlimited storage",
            "24/7 dedicated support",
            "Custom integrations",
            "SLA guarantee",
            "On-premise option",
            "Security audit",
            "Custom contracts",
          ],
          cta: "Contact sales",
        },
      ],
    },
    cta: {
      titleLine1: "Ready to build",
      titleLine2: "something great?",
      description:
        "Join thousands of teams shipping faster with Optimus. Start free, scale infinitely.",
      startBuilding: "Start building free",
      talkToSales: "Talk to sales",
      noCreditCard: "No credit card required",
    },
    footer: {
      description:
        "The platform for teams who ship. Build, deploy, and scale with unprecedented velocity.",
      allRights: "2025 Optimus. All rights reserved.",
      allSystems: "All systems operational",
      hiring: "Hiring",
      columns: {
        Product: "Product",
        Developers: "Developers",
        Company: "Company",
        Legal: "Legal",
      },
      links: {
        features: "Features",
        howItWorks: "How it works",
        pricing: "Pricing",
        integrations: "Integrations",
        documentation: "Documentation",
        apiReference: "API Reference",
        sdk: "SDK",
        status: "Status",
        about: "About",
        blog: "Blog",
        careers: "Careers",
        contact: "Contact",
        privacy: "Privacy",
        terms: "Terms",
        security: "Security",
      },
    },
  },
  es: {
    nav: {
      links: {
        features: "Funciones",
        howItWorks: "Cómo funciona",
        developers: "Desarrolladores",
        pricing: "Precios",
      },
      signIn: "Iniciar sesión",
      startCreating: "Empezar a crear",
      toggleMenu: "Abrir menú",
    },
    hero: {
      eyebrow: "La plataforma para equipos modernos",
      titleLine1: "La plataforma",
      titleTo: "para",
      rotatingWords: ["crear", "construir", "escalar", "lanzar"],
      description:
        "Tu kit de herramientas para dejar de configurar y empezar a innovar. Crea, despliega y escala las mejores experiencias de forma segura.",
      startTrial: "Prueba gratis",
      watchDemo: "Ver demo",
      stats: [
        { value: "20 días", label: "ahorrados en builds", company: "NETFLIX" },
        { value: "98%", label: "despliegues más rápidos", company: "STRIPE" },
        { value: "300%", label: "más rendimiento", company: "LINEAR" },
        { value: "6x", label: "más rápido al lanzar", company: "NOTION" },
      ],
    },
    features: {
      eyebrow: "Capacidades",
      titleLine1: "Todo lo que necesitas.",
      titleLine2: "Nada que no necesites.",
      items: [
        {
          title: "Despliegue instantáneo",
          description:
            "Lleva a producción en segundos. Nuestra red de edge garantiza que tus aplicaciones carguen al instante en cualquier parte del mundo.",
        },
        {
          title: "Flujos nativos con IA",
          description:
            "Crea aplicaciones inteligentes con capacidades de IA integradas. Desde la inferencia hasta el entrenamiento, todo escala automáticamente.",
        },
        {
          title: "Colaboración en tiempo real",
          description:
            "Trabajen juntos sin fricciones. Vista previa en vivo, feedback instantáneo y un control de versiones que de verdad tiene sentido.",
        },
        {
          title: "Seguridad empresarial",
          description:
            "Cifrado de nivel bancario, cumplimiento SOC 2 y controles de acceso granulares. Tus datos siguen siendo tuyos.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "Proceso",
      titleLine1: "Tres pasos.",
      titleLine2: "Posibilidades infinitas.",
      ready: "Listo",
      fileName: "workflow.ts",
      steps: [
        {
          title: "Conecta tus herramientas",
          description:
            "Intégrate con tu stack actual en minutos. Soportamos más de 200 fuentes de datos de fábrica.",
        },
        {
          title: "Construye tu flujo de trabajo",
          description:
            "Diseña automatizaciones potentes con nuestro editor visual o escribe código directamente.",
        },
        {
          title: "Lanza a producción",
          description:
            "Despliega globalmente sin configuración. Tu app sale en vivo en menos de 30 segundos.",
        },
      ],
    },
    infrastructure: {
      eyebrow: "Infraestructura",
      titleLine1: "Global por",
      titleLine2: "defecto.",
      description:
        "Despliega una vez, ejecuta en todas partes. Nuestra red de edge abarca 17 centros de datos en 6 continentes, con una latencia menor a 50 ms para el 99% del mundo.",
      stats: {
        dataCenters: "Centros de datos",
        uptime: "SLA de disponibilidad",
        latency: "Latencia global",
      },
      edgeNetwork: "Red de Edge",
      allOperational: "Todo operativo",
      regions: {
        usWest: "EE. UU. Oeste",
        usEast: "EE. UU. Este",
        europe: "Europa",
        asiaPacific: "Asia-Pacífico",
        oceania: "Oceanía",
        southAmerica: "Sudamérica",
      },
    },
    metrics: {
      eyebrow: "Métricas en vivo",
      titleLine1: "Un rendimiento que",
      titleLine2: "puedes medir.",
      live: "En vivo",
      items: [
        "Solicitudes a la API hoy",
        "Disponibilidad este trimestre",
        "Tiempo medio de respuesta",
        "Países atendidos",
      ],
    },
    integrations: {
      eyebrow: "Integraciones",
      titleLine1: "Funciona con todo",
      titleLine2: "lo que ya usas.",
      description:
        "Más de 200 integraciones predefinidas. Conecta todo tu stack en minutos.",
      categories: {
        versionControl: "Control de versiones",
        communication: "Comunicación",
        payments: "Pagos",
        database: "Base de datos",
        cache: "Caché",
        cloud: "Nube",
        hosting: "Hosting",
        design: "Diseño",
        projectManagement: "Gestión de proyectos",
        documentation: "Documentación",
        aiml: "IA/ML",
      },
    },
    security: {
      eyebrow: "Seguridad",
      titleLine1: "La confianza es",
      titleLine2: "innegociable.",
      description:
        "La seguridad de nivel empresarial no es opcional. Está integrada en cada capa de nuestra plataforma, desde la infraestructura hasta la aplicación.",
      features: [
        {
          title: "SOC 2 Type II",
          description:
            "Controles de seguridad auditados de forma independiente con monitoreo continuo.",
        },
        {
          title: "Cifrado de extremo a extremo",
          description:
            "Cifrado AES-256 para datos en reposo y TLS 1.3 en tránsito.",
        },
        {
          title: "Arquitectura de confianza cero",
          description:
            "Cada solicitud se autentica y autoriza. Sin excepciones.",
        },
        {
          title: "GDPR y HIPAA",
          description:
            "Cumplimiento total con las normativas de protección de datos y salud.",
        },
      ],
    },
    developers: {
      eyebrow: "Para desarrolladores",
      titleLine1: "Hecho por devs.",
      titleLine2: "Para devs.",
      description:
        "Un SDK diseñado con cuidado que no se interpone en tu camino. Lanza más rápido con APIs intuitivas y documentación excepcional.",
      tabs: {
        install: "Instalar",
        initialize: "Inicializar",
        deploy: "Desplegar",
      },
      copyCode: "Copiar código",
      readDocs: "Leer la documentación",
      viewGitHub: "Ver en GitHub",
      features: [
        {
          title: "Nativo de TypeScript",
          description: "Seguridad de tipos total con tipos autogenerados.",
        },
        {
          title: "Sin configuración",
          description: "Valores por defecto sensatos que simplemente funcionan.",
        },
        {
          title: "Listo para edge",
          description: "Funciona en cualquier lugar: Node, Deno, Bun, navegadores.",
        },
        {
          title: "12KB comprimido",
          description: "Ligero y sin dependencias.",
        },
      ],
    },
    testimonials: {
      label: "Lo que dicen",
      keyResult: "Resultado clave",
      trustedBy: "Con la confianza de equipos visionarios",
      items: [
        {
          quote:
            "Optimus transformó nuestro pipeline de despliegue. Lo que antes tomaba horas ahora ocurre en segundos.",
          role: "CTO",
          metric: "Despliegues 10x más rápidos",
        },
        {
          quote:
            "La experiencia de desarrollo no tiene rival. La productividad de nuestro equipo nunca había sido tan alta.",
          role: "Líder de Ingeniería",
          metric: "40% más funciones lanzadas",
        },
        {
          quote:
            "Por fin, una infraestructura que escala con nuestra ambición. Cero caídas desde que cambiamos.",
          role: "VP de Ingeniería",
          metric: "99.99% de disponibilidad",
        },
        {
          quote:
            "Las integraciones son perfectas. Conectamos todo nuestro stack en una sola tarde.",
          role: "Fundador",
          metric: "Más de 50 integraciones usadas",
        },
      ],
    },
    pricing: {
      eyebrow: "Precios",
      titleLine1: "Precios simples",
      titleLine2: "y transparentes",
      description:
        "Empieza gratis y escala a medida que creces. Sin tarifas ocultas, sin sorpresas.",
      monthly: "Mensual",
      annual: "Anual",
      save: "Ahorra 17%",
      mostPopular: "Más popular",
      perMonth: "/mes",
      custom: "Personalizado",
      bottomNote:
        "Todos los planes incluyen actualizaciones automáticas, HTTPS y protección DDoS.",
      compareFeatures: "Comparar todas las funciones",
      plans: [
        {
          name: "Starter",
          description: "Para individuos y proyectos pequeños",
          features: [
            "Hasta 3 proyectos",
            "1GB de almacenamiento",
            "Soporte de la comunidad",
            "Analíticas básicas",
            "Certificados SSL",
          ],
          cta: "Empezar gratis",
        },
        {
          name: "Pro",
          description: "Para equipos y empresas en crecimiento",
          features: [
            "Proyectos ilimitados",
            "100GB de almacenamiento",
            "Soporte prioritario",
            "Analíticas avanzadas",
            "Dominios personalizados",
            "Colaboración en equipo",
            "Acceso a la API",
          ],
          cta: "Iniciar prueba",
        },
        {
          name: "Enterprise",
          description: "Para operaciones a gran escala",
          features: [
            "Todo lo de Pro",
            "Almacenamiento ilimitado",
            "Soporte dedicado 24/7",
            "Integraciones personalizadas",
            "Garantía de SLA",
            "Opción on-premise",
            "Auditoría de seguridad",
            "Contratos personalizados",
          ],
          cta: "Contactar ventas",
        },
      ],
    },
    cta: {
      titleLine1: "¿Listo para construir",
      titleLine2: "algo increíble?",
      description:
        "Únete a miles de equipos que lanzan más rápido con Optimus. Empieza gratis, escala sin límites.",
      startBuilding: "Construir gratis",
      talkToSales: "Hablar con ventas",
      noCreditCard: "No se requiere tarjeta de crédito",
    },
    footer: {
      description:
        "La plataforma para equipos que lanzan. Crea, despliega y escala con una velocidad sin precedentes.",
      allRights: "2025 Optimus. Todos los derechos reservados.",
      allSystems: "Todos los sistemas operativos",
      hiring: "Contratando",
      columns: {
        Product: "Producto",
        Developers: "Desarrolladores",
        Company: "Empresa",
        Legal: "Legal",
      },
      links: {
        features: "Funciones",
        howItWorks: "Cómo funciona",
        pricing: "Precios",
        integrations: "Integraciones",
        documentation: "Documentación",
        apiReference: "Referencia de la API",
        sdk: "SDK",
        status: "Estado",
        about: "Acerca de",
        blog: "Blog",
        careers: "Empleo",
        contact: "Contacto",
        privacy: "Privacidad",
        terms: "Términos",
        security: "Seguridad",
      },
    },
  },
} as const;

type LanguageContextValue = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations["en"];
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem("optimus-lang") as Language | null;
    if (stored === "en" || stored === "es") {
      setLanguageState(stored);
    } else if (navigator.language.toLowerCase().startsWith("es")) {
      setLanguageState("es");
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    window.localStorage.setItem("optimus-lang", lang);
    document.documentElement.lang = lang;
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value: LanguageContextValue = {
    language,
    setLanguage,
    t: translations[language] as Translations["en"],
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
