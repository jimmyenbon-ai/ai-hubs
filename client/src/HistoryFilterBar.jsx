import { useState } from 'react';
import { Icon } from './components/Icons';

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

  const hasDateFilter = !!(dateFrom || dateTo);

  return (
    <div className="history-filter-bar">
      {/* 搜索栏 */}
      <form className="history-filter-search" onSubmit={handleSearchSubmit}>
        <input
          className="input-field small"
          placeholder="搜索关键词..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn-outline small">搜索</button>
        {search && (
          <button type="button" className="btn-outline small" onClick={handleClearSearch}><Icon.X size={12} /></button>
        )}
      </form>

      {/* 日期筛选 */}
      <div className="history-filter-dates">
        <input
          type="date"
          className="input-field small"
          value={dateFrom || ''}
          onChange={e => onDateFromChange(e.target.value)}
          title="开始日期"
        />
        <span className="history-filter-date-sep">至</span>
        <input
          type="date"
          className="input-field small"
          value={dateTo || ''}
          onChange={e => onDateToChange(e.target.value)}
          title="结束日期"
        />
        {hasDateFilter && (
          <button type="button" className="btn-outline small" onClick={handleClearDate}>清除</button>
        )}
      </div>

      {/* 分页 & 页码 */}
      <div className="history-filter-pagination">
        {total > 0 && (
          <>
            <span className="history-filter-total">共 {total} 条</span>
            <select
              className="select-field"
              style={{ fontSize: 12, padding: '4px 24px 4px 6px' }}
              value={pageSize || 20}
              onChange={e => onPageSizeChange(Number(e.target.value))}
            >
              {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}条/页</option>)}
            </select>
          </>
        )}

        {totalPages > 1 && (
          <div className="history-filter-page-btns">
            <button
              className="btn-outline small"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              ‹
            </button>
            <span className="history-filter-page-info">{page}/{totalPages}</span>
            <button
              className="btn-outline small"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
