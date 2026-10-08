const GridBackground: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="absolute inset-0 bg-grid-pattern opacity-30" />
    <div
      className="orb orb-primary absolute w-[500px] h-[500px] -top-[200px] -right-[200px] opacity-20 animate-orb-float-1"
    />
    <div
      className="orb orb-secondary absolute w-[400px] h-[400px] -bottom-[150px] -left-[150px] opacity-15 animate-orb-float-2"
    />
    <div
      className="orb orb-accent absolute w-[300px] h-[300px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-10 animate-orb-float-1-reverse"
    />
  </div>
);

export default GridBackground;
