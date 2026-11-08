import React, { useState, useEffect, useMemo } from 'react';
import { 
  PlusCircle, 
  History, 
  CreditCard, 
  Gift, 
  TrendingDown, 
  Users, 
  Share2, 
  Ticket,
  LucideIcon
} from 'lucide-react';

export interface DonutMenuItem {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  color: string;
  glowColor: string;
  hoverFill: string;
  metric?: string;
  metricLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}

interface DonutOverviewMenuProps {
  totalCoupons: number;
  totalBooks: number;
  timeframe: 'overall' | 'today';
  totalSales: number;
  totalCredit: number;
  totalHandover: number;
  txnCount: number;
  canShareReport?: boolean;
  onOpenShareReport?: () => void;
  onScrollToAddSale?: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const DonutOverviewMenu: React.FC<DonutOverviewMenuProps> = ({
  totalCoupons,
  totalBooks,
  timeframe,
  totalSales,
  totalCredit,
  totalHandover,
  txnCount,
  canShareReport = true,
  onOpenShareReport,
  onScrollToAddSale,
  onNavigateTab,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [animatedCoupons, setAnimatedCoupons] = useState<number>(totalCoupons);

  // Smooth count animation when totalCoupons changes
  useEffect(() => {
    let start = animatedCoupons;
    const end = totalCoupons;
    if (start === end) return;

    const duration = 600; // ms
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * ease);
      setAnimatedCoupons(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    const handle = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(handle);
  }, [totalCoupons]);

  // Construct items for the donut slices
  const menuItems: DonutMenuItem[] = useMemo(() => {
    const items: DonutMenuItem[] = [
      {
        id: 'add-sale',
        title: 'Add Sale',
        subtitle: 'Quick Entry',
        icon: PlusCircle,
        color: '#2563eb', // Blue-600
        glowColor: 'rgba(37, 99, 235, 0.45)',
        hoverFill: '#2563eb',
        metric: 'New Entry',
        metricLabel: 'Scroll to Form',
        onClick: () => {
          if (onScrollToAddSale) {
            onScrollToAddSale();
          } else {
            const el = document.getElementById('dashboard-add-sale-form-container');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }
        }
      },
      {
        id: 'sales-history',
        title: 'Sales History',
        subtitle: `${txnCount} Records`,
        icon: History,
        color: '#334155', // Slate-700
        glowColor: 'rgba(51, 65, 85, 0.45)',
        hoverFill: '#334155',
        metric: `${txnCount} Txns`,
        metricLabel: 'View Sales History',
        onClick: () => onNavigateTab?.('transactions')
      },
      {
        id: 'credit-ledger',
        title: 'Credit Ledger',
        subtitle: totalCredit > 0 ? `₹${totalCredit.toLocaleString('en-IN')}` : 'Balances',
        icon: CreditCard,
        color: '#dc2626', // Red-600
        glowColor: 'rgba(220, 38, 38, 0.45)',
        hoverFill: '#dc2626',
        metric: `₹${totalCredit.toLocaleString('en-IN')}`,
        metricLabel: 'Pending Credit',
        onClick: () => onNavigateTab?.('credit')
      },
      {
        id: 'prize-collection',
        title: 'Prize Collection',
        subtitle: '111 Prizes',
        icon: Gift,
        color: '#d97706', // Amber-600
        glowColor: 'rgba(217, 119, 6, 0.45)',
        hoverFill: '#d97706',
        metric: '111 Prizes',
        metricLabel: 'Sponsors & Trust',
        onClick: () => onNavigateTab?.('prize-collection')
      },
      {
        id: 'income-expense',
        title: 'Income & Expense',
        subtitle: 'Cash Flow',
        icon: TrendingDown,
        color: '#4f46e5', // Indigo-600
        glowColor: 'rgba(79, 70, 229, 0.45)',
        hoverFill: '#4f46e5',
        metric: 'Cash Flow',
        metricLabel: 'Accounts & Expenses',
        onClick: () => onNavigateTab?.('income-expense')
      },
      {
        id: 'treasury-handover',
        title: 'Tre Handover',
        subtitle: totalHandover > 0 ? `₹${totalHandover.toLocaleString('en-IN')}` : 'Secretary',
        icon: Users,
        color: '#059669', // Emerald-600
        glowColor: 'rgba(5, 150, 105, 0.45)',
        hoverFill: '#059669',
        metric: `₹${totalHandover.toLocaleString('en-IN')}`,
        metricLabel: 'Treasury Handover',
        onClick: () => onNavigateTab?.('secretary-handover')
      }
    ];

    if (canShareReport) {
      items.push({
        id: 'share-report',
        title: 'Share Report',
        subtitle: 'Daily Card',
        icon: Share2,
        color: '#0284c7', // Sky-600
        glowColor: 'rgba(2, 132, 199, 0.45)',
        hoverFill: '#0284c7',
        metric: 'Daily Summary',
        metricLabel: 'WhatsApp & Card',
        onClick: () => onOpenShareReport?.()
      });
    }

    return items;
  }, [
    canShareReport,
    onNavigateTab,
    onOpenShareReport,
    onScrollToAddSale,
    totalCredit,
    totalHandover,
    txnCount
  ]);

  // Geometry configuration
  const Cx = 260;
  const Cy = 260;
  const Rout = 246; // Outer radius of the donut
  const Rin = 126;  // Inner radius of the donut
  const Rmid = (Rout + Rin) / 2; // Mid radius for text & icons = 186
  const Rhub = 114; // Center hub radius

  const N = menuItems.length;
  const deltaAngle = 360 / N;
  const gapAngle = N >= 7 ? 3.2 : 3.8; // Gap in degrees between slices

  // Helper to build annular sector SVG path
  const buildSectorPath = (index: number) => {
    // Slices start from top (-90 degrees)
    const midAngle = -90 + index * deltaAngle;
    const halfSpan = (deltaAngle - gapAngle) / 2;
    const startAngle = midAngle - halfSpan;
    const endAngle = midAngle + halfSpan;

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const a1 = toRad(startAngle);
    const a2 = toRad(endAngle);

    const xOut1 = Cx + Rout * Math.cos(a1);
    const yOut1 = Cy + Rout * Math.sin(a1);
    const xOut2 = Cx + Rout * Math.cos(a2);
    const yOut2 = Cy + Rout * Math.sin(a2);

    const xIn2 = Cx + Rin * Math.cos(a2);
    const yIn2 = Cy + Rin * Math.sin(a2);
    const xIn1 = Cx + Rin * Math.cos(a1);
    const yIn1 = Cy + Rin * Math.sin(a1);

    // Large arc flag is 0 because each slice is < 180 deg
    return `M ${xIn1.toFixed(2)} ${yIn1.toFixed(2)} ` +
           `L ${xOut1.toFixed(2)} ${yOut1.toFixed(2)} ` +
           `A ${Rout} ${Rout} 0 0 1 ${xOut2.toFixed(2)} ${yOut2.toFixed(2)} ` +
           `L ${xIn2.toFixed(2)} ${yIn2.toFixed(2)} ` +
           `A ${Rin} ${Rin} 0 0 0 ${xIn1.toFixed(2)} ${yIn1.toFixed(2)} ` +
           `Z`;
  };

  const activeItem = hoveredIndex !== null ? menuItems[hoveredIndex] : null;

  return (
    <div className="relative w-full max-w-[490px] mx-auto select-none">
      {/* SVG Container */}
      <svg 
        viewBox="0 0 520 520" 
        className="w-full h-auto overflow-visible drop-shadow-sm transition-all"
        style={{ touchAction: 'manipulation' }}
      >
        <defs>
          {/* Default soft drop shadow for slices */}
          <filter id="donut-slice-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.08" />
          </filter>

          {/* Elevated hover drop shadow for active slice */}
          <filter id="donut-slice-shadow-hover" x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.18" />
          </filter>

          {/* Center Hub circular shadow */}
          <filter id="center-hub-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#0f172a" floodOpacity="0.10" />
          </filter>
        </defs>

        {/* Framing circle ring behind inner gap (as shown in reference image) */}
        <circle 
          cx={Cx} 
          cy={Cy} 
          r={Rin - 6} 
          fill="none" 
          stroke="#e2e8f0" 
          strokeWidth="2.5" 
          className="opacity-70"
        />

        {/* Outer donut slices */}
        {menuItems.map((item, idx) => {
          const isHovered = hoveredIndex === idx;
          const midAngle = -90 + idx * deltaAngle;
          const radMid = (midAngle * Math.PI) / 180;

          // Radial shift when hovered (pushes outward along radial line by 7px)
          const pushDistance = isHovered ? 7 : 0;
          const transX = pushDistance * Math.cos(radMid);
          const transY = pushDistance * Math.sin(radMid);

          // Center coordinate for slice text & icon
          const Tx = Cx + Rmid * Math.cos(radMid);
          const Ty = Cy + Rmid * Math.sin(radMid);

          // Calculate readable rotation: tangent to the circle, auto-flipped so it is never upside-down
          let rotDeg = midAngle + 90;
          while (rotDeg > 90) rotDeg -= 180;
          while (rotDeg < -90) rotDeg += 180;

          const IconComponent = item.icon;

          return (
            <g
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={item.title}
              onClick={item.onClick}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              onTouchStart={() => setHoveredIndex(idx)}
              onFocus={() => setHoveredIndex(idx)}
              onBlur={() => setHoveredIndex(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  item.onClick();
                }
              }}
              className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
              style={{
                transform: `translate(${transX.toFixed(2)}px, ${transY.toFixed(2)}px)`,
                transformOrigin: `${Cx}px ${Cy}px`,
                transition: 'transform 0.22s cubic-bezier(0.34, 1.45, 0.64, 1), filter 0.22s ease',
                filter: isHovered 
                  ? `url(#donut-slice-shadow-hover) drop-shadow(0 6px 14px ${item.glowColor})` 
                  : 'url(#donut-slice-shadow)',
              }}
            >
              {/* Annular Slice Path */}
              <path
                d={buildSectorPath(idx)}
                fill={isHovered ? item.hoverFill : '#ffffff'}
                stroke={isHovered ? item.hoverFill : '#e2e8f0'}
                strokeWidth={isHovered ? 2 : 1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{
                  transition: 'fill 0.22s ease, stroke 0.22s ease',
                }}
              />

              {/* Text & Icon Group */}
              <g 
                transform={`translate(${Tx.toFixed(2)}, ${Ty.toFixed(2)}) rotate(${rotDeg.toFixed(2)})`}
                className="pointer-events-none"
              >
                {/* SVG Icon centered at top of text group */}
                <g 
                  transform="translate(-10, -26)"
                  style={{
                    color: isHovered ? '#ffffff' : item.color,
                    transition: 'color 0.22s ease',
                  }}
                >
                  <IconComponent size={20} strokeWidth={2.2} />
                </g>

                {/* Primary Title */}
                <text
                  x={0}
                  y={6}
                  textAnchor="middle"
                  fill={isHovered ? '#ffffff' : '#0f172a'}
                  className="font-black select-none text-[12px] tracking-tight"
                  style={{
                    fontWeight: 900,
                    letterSpacing: '-0.02em',
                    transition: 'fill 0.22s ease',
                  }}
                >
                  {item.title}
                </text>

                {/* Subtitle / Metadata */}
                <text
                  x={0}
                  y={20}
                  textAnchor="middle"
                  fill={isHovered ? 'rgba(255,255,255,0.92)' : '#64748b'}
                  className="font-bold select-none text-[9.5px]"
                  style={{
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    transition: 'fill 0.22s ease',
                  }}
                >
                  {item.subtitle}
                </text>
              </g>
            </g>
          );
        })}

        {/* Center Hub SVG Circle */}
        <circle
          cx={Cx}
          cy={Cy}
          r={Rhub}
          fill="#ffffff"
          stroke="#f1f5f9"
          strokeWidth="2.5"
          filter="url(#center-hub-shadow)"
          className="transition-all"
        />
      </svg>

      {/* Center Interactive Hub (HTML Overlay for rich animation and crisp counter) */}
      <div 
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        aria-live="polite"
      >
        <div 
          className="w-[43%] h-[43%] rounded-full bg-white/95 backdrop-blur-xs flex flex-col items-center justify-center p-3 text-center pointer-events-auto select-none transition-all duration-300"
        >
          {activeItem ? (
            /* Hovered Slice Details */
            <div 
              key={activeItem.id} 
              className="flex flex-col items-center justify-center space-y-1 animate-in zoom-in-90 fade-in duration-200"
            >
              <div 
                className="w-9 h-9 rounded-2xl flex items-center justify-center shadow-xs transition-colors"
                style={{
                  backgroundColor: `${activeItem.color}15`,
                  color: activeItem.color
                }}
              >
                <activeItem.icon size={20} className="animate-pulse" />
              </div>

              <div 
                className="text-base sm:text-lg font-black tracking-tight leading-tight"
                style={{ color: activeItem.color }}
              >
                {activeItem.metric || activeItem.title}
              </div>

              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider line-clamp-1">
                {activeItem.metricLabel || activeItem.title}
              </span>

              <button
                type="button"
                onClick={activeItem.onClick}
                className="inline-flex items-center gap-1 text-[9px] font-black text-white px-3 py-1 rounded-full shadow-xs active:scale-95 transition-all cursor-pointer mt-0.5"
                style={{ backgroundColor: activeItem.color }}
              >
                <span>Click to open</span>
                <span>→</span>
              </button>
            </div>
          ) : (
            /* Default Center: Animated Number of Coupons (Matches user image center card) */
            <div className="flex flex-col items-center justify-center space-y-0.5 animate-in fade-in duration-300">
              <div className="flex items-center gap-1 text-amber-500">
                <Ticket size={18} className="animate-bounce duration-1000" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  {timeframe === 'today' ? "Today" : "Total"}
                </span>
              </div>

              {/* Center Animated Coupon Number */}
              <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tighter leading-none mt-0.5">
                {animatedCoupons.toLocaleString('en-IN')}
              </div>

              {/* Subtitle: Number of Coupons */}
              <div className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-600 mt-0.5">
                Coupons Sold
              </div>

              {/* Books info pill */}
              <div className="text-[9px] font-extrabold text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-full mt-1">
                {totalBooks > 0 ? `${totalBooks} Books` : 'Coupons'} · {timeframe === 'today' ? "Today" : "Overall"}
              </div>

              {/* Subtle user instruction matching "↻ Tab here" */}
              <div className="text-[9px] font-bold text-slate-400 mt-0.5 flex items-center gap-1">
                <span>↻ Tap button</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DonutOverviewMenu;
