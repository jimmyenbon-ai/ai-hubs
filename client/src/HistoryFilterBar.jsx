import { useState } from 'react';

export default function HistoryFilterBar({
  search, onSearchChange,
  dateFrom, onDateFromChange,
  dateTo, onDateToChange,
  page, totalPages, onPageChange,
  pageSize, onPageSizeChange,
  total,
}) {
  const [searchInput, setSearchInput] = useState(search || '');

  function handleSearchSubmit(e) {
    e?.preventDefault();
    onSearchChange(searchInput);
  }

  function handleClearSearch() {
    setSearchInput('');
    onSearchChange('');
  }

  function handleClearDate() {
    onDateFromChange('');
    onDateToChange('');
  }

  const hasFilter = !!(search || dateFrom || dateTo);

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'center',
      padding: '8px 0',
      fontSize: 12,
    }}>
      {/* 搜索 */}
      <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 4 }}>
        <input
          className="input-field"
          style={{ width: 140, fontSize: 12, padding: '4px 8px' }}
          placeholder="搜索关键词..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn-outline" style={{ fontSize: 11, padding: '4px 8px' }}>搜索</button>
        {search && (
          <button type="button" className="btn-outline" style={{ fontSize: 11, padding: '4px 8px' }} onClick={handleClearSearch}>✕</button>
        )}
      </form>

      {/* 日期筛选 */}
      <input
        type="date"
        className="input-field"
        style={{ width: 130, fontSize: 12, padding: '4px 8px' }}
        value={dateFrom || ''}
        onChange={e => onDateFromChange(e.target.value)}
        title="开始日期"
      />
      <span style={{ color: 'var(--text-muted)' }}>至</span>
      <input
        type="date"
        className="input-field"
        style={{ width: 130, fontSize: 12, padding: '4px 8px' }}
        value={dateTo || ''}
        onChange={e => onDateToChange(e.target.value)}
        title="结束日期"
      />
      {hasFilter && (
        <button type="button" className="btn-outline" style={{ fontSize: 11, padding: '4px 8px' }} onClick={handleClearDate}>
          清除日期
        </button>
      )}

      <div style={{ flex: 1 }} />

      {/* 每页条数 */}
      {total > 0 && (
        <>
          <span style={{ color: 'var(--text-muted)' }}>共 {total} 条</span>
          <select
            className="input-field"
            style={{ width: 60, fontSize: 12, padding: '4px 4px' }}
            value={pageSize || 20}
            onChange={e => onPageSizeChange(Number(e.target.value))}
          >
            {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}条</option>)}
          </select>
        </>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            className="btn-outline"
            style={{ fontSize: 11, padding: '4px 8px' }}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            ‹
          </button>
          <span style={{ fontSize: 12, padding: '0 4px' }}>{page}/{totalPages}</span>
          <button
            className="btn-outline"
            style={{ fontSize: 11, padding: '4px 8px' }}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
