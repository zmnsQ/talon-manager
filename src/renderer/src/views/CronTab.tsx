import { useState, useEffect } from 'react'
import { Plus, Trash2, Play, RefreshCcw, Clock, ChevronRight } from 'lucide-react'

interface ScheduleTask {
  name: string
  cron?: string
  every?: string
  prompt: string
  agentId?: string
  enabled: boolean
}

const PRESET_INTERVALS = [
  { label: '每 30 分钟', value: '30m' },
  { label: '每小时', value: '1h' },
  { label: '每 2 小时', value: '2h' },
  { label: '每天 9 点', value: '0 9 * * *', isCron: true },
  { label: '每天 20 点', value: '0 20 * * *', isCron: true },
  { label: '每周一 9 点', value: '0 9 * * 1', isCron: true },
  { label: '自定义', value: 'custom' },
]

const DEFAULT_TASK: ScheduleTask = { name: '', every: '1h', prompt: '', agentId: 'main', enabled: true }

export default function CronTab() {
  const [tasks, setTasks] = useState<ScheduleTask[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ScheduleTask>(DEFAULT_TASK)
  const [presetIdx, setPresetIdx] = useState(1)
  const [customInterval, setCustomInterval] = useState('')
  const [agents, setAgents] = useState<string[]>(['main'])
  const api = (window as any).api

  useEffect(() => { load() }, [])

  async function load() {
    const [schedule, agentsCfg] = await Promise.all([api.getSchedule(), api.getAgentsConfig()])
    setTasks(schedule ?? [])
    const agentIds: string[] = (agentsCfg?.list ?? []).map((a: any) => a.id)
    setAgents(agentIds.length ? agentIds : ['main'])
  }

  async function save(updated: ScheduleTask[]) {
    setTasks(updated)
    await api.saveSchedule(updated)
  }

  function addTask() {
    if (!form.name.trim() || !form.prompt.trim()) return
    const task: ScheduleTask = { ...form }
    const preset = PRESET_INTERVALS[presetIdx]
    if (preset.value === 'custom') {
      if (customInterval.includes('*')) task.cron = customInterval
      else task.every = customInterval
      delete task.every; if (!task.cron) task.every = customInterval
    } else if (preset.isCron) {
      task.cron = preset.value; delete task.every
    } else {
      task.every = preset.value; delete task.cron
    }
    save([...tasks, task])
    setForm(DEFAULT_TASK)
    setShowForm(false)
    setPresetIdx(1)
    setCustomInterval('')
  }

  function toggleTask(idx: number) {
    const updated = tasks.map((t, i) => i === idx ? { ...t, enabled: !t.enabled } : t)
    save(updated)
  }

  function deleteTask(idx: number) {
    save(tasks.filter((_, i) => i !== idx))
  }

  function getIntervalDisplay(t: ScheduleTask) {
    if (t.cron) return `Cron: ${t.cron}`
    if (t.every) {
      const preset = PRESET_INTERVALS.find((p) => p.value === t.every && !p.isCron)
      return preset ? preset.label : `每 ${t.every}`
    }
    return '未配置'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="tech-font" style={{ fontSize: '14px' }}>定时任务</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            安排 Agent 定期自动执行操作
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={load} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCcw size={12} /> 刷新
          </button>
          <button onClick={() => setShowForm(true)} style={{ background: 'var(--accent)', border: 'none', borderRadius: '8px', padding: '8px 16px', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={14} /> 新增任务
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="card" style={{ border: '1px solid rgba(255,87,87,0.25)', background: 'rgba(255,87,87,0.04)' }}>
          <h4 style={{ marginBottom: '16px', fontSize: '12px' }}>新增定时任务</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>任务名称</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例: 每日晨报" style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '13px', outline: 'none' }} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>执行 Agent</label>
                <select value={form.agentId ?? 'main'} onChange={(e) => setForm({ ...form, agentId: e.target.value })} style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '13px' }}>
                  {agents.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>执行频率</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {PRESET_INTERVALS.map((p, i) => (
                  <button key={p.value} onClick={() => setPresetIdx(i)} style={{ padding: '6px 12px', background: presetIdx === i ? 'rgba(255,87,87,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${presetIdx === i ? 'rgba(255,87,87,0.3)' : 'var(--border)'}`, borderRadius: '20px', color: presetIdx === i ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: presetIdx === i ? 600 : 400 }}>
                    {p.label}
                  </button>
                ))}
              </div>
              {PRESET_INTERVALS[presetIdx].value === 'custom' && (
                <input value={customInterval} onChange={(e) => setCustomInterval(e.target.value)} placeholder="例: 2h 或 cron: 0 9 * * *" style={{ marginTop: '8px', width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '13px', outline: 'none' }} />
              )}
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>执行指令 (Prompt)</label>
              <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="例: 检查今天的待办事项并给我一份摘要" rows={3} style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '13px', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '9px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button onClick={addTask} disabled={!form.name.trim() || !form.prompt.trim()} style={{ padding: '9px 18px', background: 'var(--accent)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: (!form.name.trim() || !form.prompt.trim()) ? 0.4 : 1 }}>
                <ChevronRight size={14} /> 添加任务
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
          <Clock size={40} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
          <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>暂无定时任务</p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>点击「新增任务」安排 Agent 定期自动执行</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {tasks.map((task, idx) => (
            <div key={idx} className="card" style={{ padding: '16px 20px', opacity: task.enabled ? 1 : 0.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Toggle */}
                <div onClick={() => toggleTask(idx)} style={{ width: '36px', height: '20px', background: task.enabled ? 'var(--accent)' : '#333', borderRadius: '10px', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background 0.2s' }}>
                  <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: task.enabled ? '18px' : '2px', transition: 'left 0.2s' }} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <p style={{ fontWeight: 600, fontSize: '12px' }}>{task.name}</p>
                    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(255,87,87,0.1)', color: 'var(--accent)', border: '1px solid rgba(255,87,87,0.2)', fontWeight: 600 }}>
                      {getIntervalDisplay(task)}
                    </span>
                    {task.agentId && task.agentId !== 'main' && (
                      <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}>
                        Agent: {task.agentId}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.prompt}</p>
                </div>

                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button title="立即执行" style={{ padding: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <Play size={13} />
                  </button>
                  <button onClick={() => deleteTask(idx)} title="删除" style={{ padding: '6px', background: 'rgba(255,87,87,0.08)', border: '1px solid rgba(255,87,87,0.15)', borderRadius: '7px', color: '#ff5757', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="card" style={{ padding: '14px', background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)' }}>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          定时任务配置保存至 <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '4px' }}>~/.openclaw/openclaw.json</code> 的 <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '4px' }}>schedule</code> 字段，需要网关处于运行状态才会执行。
        </p>
      </div>
    </div>
  )
}
