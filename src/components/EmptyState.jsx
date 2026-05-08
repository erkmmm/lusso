export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      {Icon && (
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Icon size={24} className="text-slate-400" />
        </div>
      )}
      <h3 className="text-slate-700 font-semibold text-base mb-1">{title}</h3>
      {description && <p className="text-slate-400 text-sm mb-5 max-w-xs">{description}</p>}
      {action && action}
    </div>
  );
}
