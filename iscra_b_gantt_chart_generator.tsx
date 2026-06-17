import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Play, AlertCircle, HelpCircle, ChevronDown, ChevronUp, Download, Check, Users, LayoutList, Activity } from 'lucide-react';

// --- Utility Functions ---

const adjustColor = (hex, percent) => {
  if (!hex) return '#cccccc';
  hex = hex.replace(/^\s*#|\s*$/g, '');
  if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
  
  let r = parseInt(hex.substring(0, 2), 16),
      g = parseInt(hex.substring(2, 4), 16),
      b = parseInt(hex.substring(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#cccccc';

  r = Math.round(r * (1 + percent / 100));
  g = Math.round(g * (1 + percent / 100));
  b = Math.round(b * (1 + percent / 100));

  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));

  const toHex = (c) => {
    const hexStr = c.toString(16);
    return hexStr.length === 1 ? '0' + hexStr : hexStr;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const hexToRgba = (hex, alpha) => {
  if (!hex) return `rgba(200,200,200,${alpha})`;
  hex = hex.replace(/^\s*#|\s*$/g, '');
  if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
  
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return `rgba(${r},${g},${b},${alpha})`;
};

// --- Parser Logic ---

const parseGanttCode = (code) => {
  const lines = code.split('\n');
  const wps = {};
  const milestones = {};
  const tasks = {};
  const dependencies = [];
  const errors = [];
  const teamMembersSet = new Set();
  const teamInfo = []; // Array to store detailed member info
  let maxTaskLabelLength = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('%%') || trimmed.startsWith('title') || trimmed.startsWith('gantt')) return;

    try {
      if (trimmed.startsWith('wp ')) {
        const match = trimmed.match(/^wp\s+([\w.]+)\s+"([^"]+)"\s+(#[0-9a-fA-F]{3,6})$/);
        if (match) {
          wps[match[1]] = { id: match[1], label: match[2], color: match[3], type: 'wp' };
        } else {
          errors.push(`Line ${index + 1}: Invalid WP syntax. Use: wp ID "Label" #HexColor`);
        }
      } 
      else if (trimmed.startsWith('member ')) {
        // Syntax: member ID "Role" "Topic" [Timeline]
        // Simple regex: member ID "Role" "Topic"
        const match = trimmed.match(/^member\s+(\w+)\s+"([^"]+)"\s+"([^"]+)"(?:\s+"([^"]+)")?$/);
        if (match) {
            teamInfo.push({
                id: match[1],
                role: match[2],
                topic: match[3],
                timeline: match[4] || '' // Optional timeline override if needed, though usually part of topic string in request
            });
            teamMembersSet.add(match[1]);
        } else {
             // Fallback for simple definition without topic
             const matchSimple = trimmed.match(/^member\s+(\w+)\s+"([^"]+)"$/);
             if (matchSimple) {
                 teamInfo.push({ id: matchSimple[1], role: matchSimple[2], topic: '' });
                 teamMembersSet.add(matchSimple[1]);
             } else {
                errors.push(`Line ${index + 1}: Invalid Member syntax. Use: member ID "Role" "Topic"`);
             }
        }
      }
      else if (trimmed.startsWith('ms ')) {
        const baseMatch = trimmed.match(/^ms\s+([\w.]+)\s+"([^"]+)"\s+([\w.]+)\s+(\d+)(.*)$/);
        
        if (baseMatch) {
          const [_, id, label, parentId, monthStr, rest] = baseMatch;
          let customColor = undefined;
          let alignment = 'auto';
          let rowAlignment = 'last';
          let slack = 0;
          let labelOffset = 0;

          if (rest) {
            const tokens = rest.trim().split(/\s+/);
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (token.match(/^#[0-9a-fA-F]{3,6}$/)) {
                    customColor = token;
                } else if (token === 'left' || token === 'right') {
                    alignment = token;
                } else if (token === 'align-middle') {
                    rowAlignment = 'middle';
                } else if (token === 'align-last') {
                    rowAlignment = 'last';
                } else if (token === 'slack') {
                    // Check next token for value
                    if (i + 1 < tokens.length && !isNaN(parseInt(tokens[i+1]))) {
                        slack = parseInt(tokens[i+1]);
                        i++; // Skip next token
                    }
                } else if (token === 'label-offset') {
                    if (i + 1 < tokens.length && !isNaN(parseInt(tokens[i+1]))) {
                        labelOffset = parseInt(tokens[i+1]);
                        i++; 
                    }
                }
            }
          }

          milestones[id] = { 
            id, 
            label, 
            parentId, 
            month: parseInt(monthStr), 
            customColor, 
            alignment,
            rowAlignment,
            slack,
            labelOffset,
            type: 'ms'
          };
        } else {
          errors.push(`Line ${index + 1}: Invalid Milestone syntax. Use: ms ID "Label" WP_ID Month [left|right] [align-middle] [slack N] [label-offset N] [#HexColor]`);
        }
      } 
      else if (trimmed.startsWith('task ')) {
        const match = trimmed.match(/^task\s+([\w.]+)\s+"([^"]+)"\s+([\w.]+)\s+(\d+)\s+(\d+)(?:\s+"([^"]+)")?$/);
        
        if (match) {
          const startInput = parseInt(match[4]);
          const endInput = parseInt(match[5]);
          const teamStr = match[6] || "";
          
          const members = teamStr.split(/\s+/).filter(m => m.length > 0);
          members.forEach(m => teamMembersSet.add(m));

          const task = { 
            id: match[1], 
            label: match[2], 
            parentId: match[3], 
            start: startInput - 1, 
            end: endInput,
            type: 'task',
            team: members
          };
          tasks[match[1]] = task;
          
          // Track max length for auto-sizing
          // Estimate: ID len + Label len
          const length = task.id.length + task.label.length;
          if (length > maxTaskLabelLength) maxTaskLabelLength = length;

          dependencies.push({ from: task.id, to: task.parentId, type: 'implicit' });

        } else {
          errors.push(`Line ${index + 1}: Invalid Task syntax. Use: task ID "Label" MS_ID Start End "Team Members"`);
        }
      } 
      else if (trimmed.startsWith('dep ')) {
        const match = trimmed.match(/^dep\s+([\w.]+)\s+([\w.]+)$/);
        if (match) {
          dependencies.push({ from: match[2], to: match[1], type: 'explicit' });
        } else {
          errors.push(`Line ${index + 1}: Invalid Dependency syntax. Use: dep TaskID DependsOnID`);
        }
      } 
    } catch (e) {
      errors.push(`Line ${index + 1}: Parsing error.`);
    }
  });

  const hierarchy = [];
  let maxTime = 0;

  Object.values(wps).forEach(wp => {
    const wpNode = { ...wp, children: [] };
    const wpMilestones = Object.values(milestones).filter(m => m.parentId === wp.id);
    wpMilestones.sort((a, b) => a.month - b.month);

    wpMilestones.forEach((ms, index) => {
      let msColor;
      if (ms.customColor) {
        msColor = ms.customColor;
      } else {
        const shadePercent = -5 - (index * 12); 
        msColor = adjustColor(wp.color, shadePercent);
      }
      
      const msNode = { ...ms, children: [], color: msColor }; 
      
      if (ms.month > maxTime) maxTime = ms.month;

      const msTasks = Object.values(tasks).filter(t => t.parentId === ms.id);
      msTasks.forEach(task => {
        if (task.end > maxTime) maxTime = task.end;
        msNode.children.push({ ...task, color: msNode.color });
      });

      msNode.children.sort((a, b) => a.start - b.start);
      wpNode.children.push(msNode);
    });

    wpNode.children.sort((a, b) => a.month - b.month);
    hierarchy.push(wpNode);
  });

  const sortedTeamMembers = Array.from(teamMembersSet).sort();
  
  // Estimate task column width
  const estimatedTaskWidth = Math.max(250, (maxTaskLabelLength * 7) + 50);

  return { 
      hierarchy, 
      dependencies, 
      errors, 
      maxTime: maxTime, 
      rawTasks: tasks, 
      teamMembers: sortedTeamMembers,
      teamInfo: teamInfo,
      taskColumnWidth: estimatedTaskWidth 
  };
};

// --- Components ---

const DependencyLines = ({ dependencies, nodePositions, cellWidth, rowHeight, milestoneOffset }) => {
  return (
    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ zIndex: 10 }}>
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#334155" />
        </marker>
      </defs>
      {dependencies.map((dep, idx) => {
        const fromPos = nodePositions[dep.from];
        const toPos = nodePositions[dep.to];

        if (!fromPos || !toPos) return null;

        const slack = fromPos.slack || 0;
        const x1 = (fromPos.end * cellWidth) - slack; 
        const y1 = (fromPos.row * rowHeight) + (rowHeight / 2);
        
        let tx = (toPos.start * cellWidth);
        const ty = (toPos.row * rowHeight) + (rowHeight / 2);
        
        if (toPos.start === toPos.end) {
            tx += milestoneOffset;
        }
        
        let path = '';

        if (fromPos.row < toPos.row) {
            const targetY = ty - 12; 
            path = `M ${x1} ${y1} H ${tx} V ${targetY}`;
        } 
        else if (fromPos.row > toPos.row) {
            const targetY = ty + 12; 
            path = `M ${x1} ${y1} H ${tx} V ${targetY}`;
        }
        else {
            const targetX = tx - 12; 
            path = `M ${x1} ${y1} L ${targetX} ${ty}`;
        }

        return (
          <path
            key={idx}
            d={path}
            fill="none"
            stroke="#334155" 
            strokeWidth="2"
            markerEnd="url(#arrowhead)"
            strokeOpacity={1.0}
            strokeDasharray="0"
          />
        );
      })}
    </svg>
  );
};

export default function App() {
  const [code, setCode] = useState(`# Figure 4. ISCRA B Workplan and Timetable (12 months)
# Syntax reference:
# wp ID "Label" #HexColor
# ms ID "Label" WP_ID Month [left|right] [align-middle] [label-offset N] [#HexColor]
# task ID "Label" MS_ID StartMonth EndMonth
# dep TaskID DependsOnID

wp WP1 "Infrastructure Porting and Baseline Scaling Laws" #2563EB
wp WP2 "Neural Memory Mechanisms" #7C3AED
wp WP3 "Large-Scale Benchmarking and Validation" #059669
wp WP4 "Analysis, Dissemination, and Open Source Release" #D97706

# Deliverables / Milestones
ms D1 "D1 HPC framework + preliminary scaling report" WP1 3 align-middle #2563EB
ms D2 "D2 Trained neural memory modules" WP2 7 align-middle #7C3AED
ms D3 "D3 Evaluation results + Pareto frontier models" WP3 10 align-middle #059669
ms D4 "D4 Final report, papers + public release" WP4 12 left align-middle label-offset 10 #D97706

# WP1: Infrastructure Porting and Baseline Scaling Laws (M1-M3)
task T1.1 "Containerize EGOSTREAM and deploy on Leonardo" D1 1 2
task T1.2 "Grid-search inference: contexts, sampling rates, budgets" D1 1 3
task T1.3 "Statistical analysis and empirical scaling laws" D1 2 3

# WP2: Development of Neural Memory Mechanisms (M4-M7)
task T2.1 "Design differentiable neural gating module" D2 4 5
task T2.2 "Implement GPU-CPU-NVMe hierarchical memory tiering" D2 4 6
task T2.3 "Distributed training with DeepSpeed ZeRO" D2 5 7

# WP3: Large-Scale Benchmarking and Validation (M8-M10)
task T3.1 "Expand EGOSTREAM with longer streams and multi-hop queries" D3 8 9
task T3.2 "Validity-aware evaluation against WP1 baselines" D3 8 10
task T3.3 "Ablations: paging, retrieval, pruning and gating" D3 9 10

# WP4: Analysis, Dissemination, and Open Source Release (M11-M12)
task T4.1 "Synthesize results and finalize scaling laws" D4 11 12
task T4.2 "Prepare and submit conference manuscripts" D4 11 12
task T4.3 "Release benchmark, weights and evaluation code" D4 11 12

# Main dependencies
# WP2 relies on the infrastructure setup of WP1.
dep T2.1 T1.1
dep T2.2 T1.1
dep T2.3 T2.1
dep T2.3 T2.2

# WP3 uses both the WP1 baselines and WP2 trained modules.
dep T3.2 T1.3
dep T3.2 T2.3
dep T3.3 T3.2

# WP4 starts from the validated evaluation and ablation results.
dep T4.1 T3.3
dep T4.2 T4.1
dep T4.3 T4.1`);

  const [data, setData] = useState({ hierarchy: [], dependencies: [], errors: [], maxTime: 12, rawTasks: {}, teamMembers: [], teamInfo: [], taskColumnWidth: 360 });
  const [zoomX, setZoomX] = useState(72); 
  const [zoomY, setZoomY] = useState(38); 
  const [legendX, setLegendX] = useState(24); 
  const [legendY, setLegendY] = useState(175); 
  const [milestoneOffset, setMilestoneOffset] = useState(0); 
  const [editorHeight, setEditorHeight] = useState(300);
  const [toastMessage, setToastMessage] = useState('');
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [viewMode, setViewMode] = useState('inline'); // CHANGED TO INLINE DEFAULT
  const chartExportRef = useRef(null);
  
  useEffect(() => {
    setData(parseGanttCode(code));
  }, [code]);

  useEffect(() => {
    if (toastMessage) {
        const timer = setTimeout(() => setToastMessage(''), 3000);
        return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const layout = useMemo(() => {
    let rowIndex = 0;
    const nodePositions = {}; 
    const renderRows = []; 
    const wpRegions = []; 

    data.hierarchy.forEach(wp => {
      const wpStartRow = rowIndex;
      let wpMinTime = Infinity;
      let wpMaxTime = 0;

      renderRows.push({ type: 'wp_header', data: wp, row: rowIndex });
      rowIndex++;

      wp.children.forEach(ms => {
        const tasksStartRow = rowIndex;
        
        if (ms.month < wpMinTime) wpMinTime = ms.month;
        if (ms.month > wpMaxTime) wpMaxTime = ms.month;

        ms.children.forEach(task => {
          renderRows.push({ type: 'task', data: task, msData: ms, row: rowIndex });
          nodePositions[task.id] = { 
              row: rowIndex, 
              start: task.start, 
              end: task.end,
              slack: ms.slack || 0
          };
          
          if (task.start < wpMinTime) wpMinTime = task.start;
          if (task.end > wpMaxTime) wpMaxTime = task.end;
          
          rowIndex++;
        });

        let msRowIndex;
        if (ms.children.length > 0) {
            if (ms.rowAlignment === 'middle') {
                const midIndex = Math.floor((ms.children.length - 1) / 2);
                msRowIndex = tasksStartRow + midIndex;
            } else {
                msRowIndex = rowIndex - 1;
            }
        } else {
            renderRows.push({ type: 'empty_ms', msData: ms, row: rowIndex });
            msRowIndex = rowIndex;
            rowIndex++;
        }

        renderRows.push({ type: 'ms_marker', data: ms, row: msRowIndex });
        nodePositions[ms.id] = { row: msRowIndex, start: ms.month, end: ms.month };
      });

      if (rowIndex > wpStartRow + 1) {
        wpRegions.push({
          wp: wp,
          startRow: wpStartRow + 1,
          endRow: rowIndex,
          startTime: wpMinTime === Infinity ? 0 : wpMinTime,
          endTime: wpMaxTime,
        });
      }
    });

    return { rows: renderRows, nodePositions, wpRegions, totalRows: rowIndex };
  }, [data]);

  const MEMBER_COL_WIDTH = 30;
  const LEFT_PANE_WIDTH = viewMode === 'matrix' 
    ? data.taskColumnWidth + (data.teamMembers.length * MEMBER_COL_WIDTH)
    : data.taskColumnWidth;
    
  const HEADER_HEIGHT = 56; 
  
  const gridStep = useMemo(() => {
    if (zoomX < 15) return 12;
    if (zoomX < 25) return 6;
    if (zoomX < 40) return 3;
    if (zoomX < 60) return 2;
    return 1;
  }, [zoomX]);

  const handleSavePdf = async () => {
    if (!chartExportRef.current || isSavingPdf) return;

    try {
      setIsSavingPdf(true);
      setToastMessage('Saving PDF...');

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const element = chartExportRef.current;
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: Math.min(2, window.devicePixelRatio || 1),
        width: element.scrollWidth,
        height: element.scrollHeight,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        scrollX: 0,
        scrollY: 0,
      });

      const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
      const pdf = new jsPDF({
        orientation,
        unit: 'px',
        format: [canvas.width, canvas.height],
        compress: true,
      });

      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save('iscra-b-gantt.pdf');
      setToastMessage('PDF saved.');
    } catch (error) {
      console.error(error);
      setToastMessage('PDF export failed.');
    } finally {
      setIsSavingPdf(false);
    }
  };

  // Determine Y position for the legend anchored to T1.1.1 or WP1
  const legendTop = useMemo(() => {
      // Find row of T1.1.1
      const t1Row = layout.nodePositions['T1.1.1']?.row;
      if (t1Row !== undefined) return t1Row * zoomY + 2; 
      
      const wp1Start = layout.wpRegions.find(r => r.wp.id === 'WP1')?.startRow;
      if (wp1Start !== undefined) return wp1Start * zoomY + 2;
      
      return 60;
  }, [layout, zoomY]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans print-container relative">
      {/* Toast */}
      {toastMessage && (
          <div className="absolute top-16 right-6 z-50 bg-gray-800 text-white px-4 py-3 rounded shadow-lg flex items-center animate-fade-in-down no-print">
              <Download size={18} className="mr-2" />
              <span className="text-sm font-medium">{toastMessage}</span>
          </div>
      )}

      {/* Print Styles */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 10px; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .print-full-width { width: 100% !important; overflow: visible !important; }
          .print-container { height: auto !important; display: block !important; }
          .print-scroll-fix { overflow: visible !important; height: auto !important; max-width: none !important; }
        }
      `}</style>

      {/* App Header */}
      <header className="no-print bg-white border-b border-gray-200 p-3 flex justify-between items-center shadow-sm z-30 overflow-x-auto">
        <div className="flex items-center space-x-2 mr-4 flex-shrink-0">
          <div className="bg-indigo-600 text-white p-2 rounded-lg">
            <Play size={20} fill="currentColor" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">ISCRA B GanttGen</h1>
        </div>
        
        <div className="flex items-center space-x-6 flex-shrink-0">
           {/* View Mode Toggle */}
           <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200">
              <button 
                onClick={() => setViewMode('matrix')}
                className={`flex items-center space-x-2 px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'matrix' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Users size={14} />
                <span>Matrix</span>
              </button>
              <button 
                onClick={() => setViewMode('inline')}
                className={`flex items-center space-x-2 px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'inline' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <LayoutList size={14} />
                <span>Inline</span>
              </button>
           </div>

           <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Width</span>
              <input type="range" min="10" max="100" value={zoomX} onChange={(e) => setZoomX(parseInt(e.target.value))} className="w-20 accent-indigo-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"/>
           </div>
           
           <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Height</span>
              <input type="range" min="24" max="60" value={zoomY} onChange={(e) => setZoomY(parseInt(e.target.value))} className="w-20 accent-indigo-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"/>
           </div>

           <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Legend X</span>
              <input type="range" min="24" max="500" value={legendX} onChange={(e) => setLegendX(parseInt(e.target.value))} className="w-20 accent-indigo-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"/>
           </div>

           <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Legend Y</span>
              <input type="range" min="50" max="500" value={legendY} onChange={(e) => setLegendY(parseInt(e.target.value))} className="w-20 accent-indigo-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"/>
           </div>
           
           <button 
              onClick={handleSavePdf}
              disabled={isSavingPdf}
              className="flex items-center space-x-2 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-500 disabled:cursor-wait text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0"
           >
              <Download size={16} />
              <span>{isSavingPdf ? 'Saving...' : 'Salva'}</span>
           </button>
        </div>
      </header>

      {/* Chart Pane (Top) */}
      <div className="flex-1 overflow-auto relative custom-scrollbar bg-white print-scroll-fix">
          <div 
             ref={chartExportRef}
             className="relative min-w-max print-scroll-fix"
             style={{ 
               height: (layout.totalRows * zoomY) + HEADER_HEIGHT + 20,
               width: LEFT_PANE_WIDTH + (data.maxTime * zoomX) + 24 + milestoneOffset 
             }}
          >
             
             {/* Sticky Header Row */}
             <div 
                className="flex sticky top-0 z-30 bg-gray-50 border-b border-gray-200 shadow-sm print-scroll-fix"
                style={{ height: HEADER_HEIGHT }}
             >
                {/* Top-Left Corner (Task & Team Headers) */}
                <div 
                    className="sticky left-0 z-40 bg-gray-100 border-r border-gray-200 flex flex-col justify-end text-xs font-bold text-gray-500 uppercase"
                    style={{ width: LEFT_PANE_WIDTH }}
                >
                    <div className="flex items-center h-1/2 border-b border-gray-200 px-4">
                        Work Packages & Tasks
                    </div>
                    <div className="flex h-1/2 items-center bg-gray-50">
                        {/* Empty space for Task Name */}
                        <div style={{ width: data.taskColumnWidth }} className="px-4 border-r border-gray-200 h-full flex items-center">
                            Task
                        </div>
                        {/* Team Member Columns (Only in Matrix Mode) */}
                        {viewMode === 'matrix' && data.teamMembers.map(member => (
                            <div 
                                key={member} 
                                style={{ width: MEMBER_COL_WIDTH }} 
                                className="border-r border-gray-200 h-full flex items-center justify-center text-[10px]"
                                title={member}
                            >
                                {member}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Timeline Header */}
                <div className="flex flex-col relative" style={{ width: data.maxTime * zoomX }}>
                    {/* Years Row */}
                    <div className="flex h-1/2 border-b border-gray-200">
                        {Array.from({ length: Math.ceil(data.maxTime / 12) }).map((_, yIdx) => {
                           const startMonth = yIdx * 12;
                           const remainingMonths = Math.min(12, data.maxTime - startMonth);
                           if (remainingMonths <= 0) return null;
                           
                           return (
                             <div 
                                key={`Y${yIdx}`}
                                className="flex items-center justify-center text-xs font-bold text-gray-700 bg-gray-100 border-r border-gray-200"
                                style={{ width: zoomX * remainingMonths }}
                             >
                                Year {yIdx + 1}
                             </div>
                           );
                        })}
                    </div>
                    {/* Months Row */}
                    <div className="flex h-1/2 relative w-full">
                        {Array.from({ length: Math.ceil(data.maxTime / gridStep) }).map((_, stepIdx) => {
                            const monthIdx = stepIdx * gridStep;
                            if (monthIdx >= data.maxTime) return null;
                            const span = Math.min(gridStep, data.maxTime - monthIdx);
                            
                            const label = span > 1 
                                ? `M${monthIdx + 1}-M${monthIdx + span}` 
                                : `M${monthIdx + 1}`;

                            return (
                                <div 
                                    key={monthIdx} 
                                    className="absolute border-r border-gray-200 text-[10px] text-gray-500 flex items-center justify-center font-medium bg-gray-50"
                                    style={{ 
                                        left: monthIdx * zoomX,
                                        width: span * zoomX,
                                        height: '100%'
                                    }}
                                >
                                    {label}
                                </div>
                            );
                        })}
                    </div>
                </div>
             </div>

             {/* Chart Body Container */}
             <div className="relative">
                
                {/* Grid Lines */}
                <div 
                  className="absolute top-0 bottom-0 pointer-events-none" 
                  style={{ left: LEFT_PANE_WIDTH, width: data.maxTime * zoomX }}
                >
                    {Array.from({ length: Math.ceil(data.maxTime / gridStep) }).map((_, stepIdx) => {
                         const i = (stepIdx + 1) * gridStep;
                         if (i > data.maxTime) return null;
                         
                         return (
                            <div 
                                key={i} 
                                className={`absolute top-0 bottom-0 border-r ${i % 12 === 0 ? 'border-gray-300' : 'border-dashed border-gray-100'}`}
                                style={{ left: i * zoomX, width: 0, transform: 'translateX(-1px)' }}
                            />
                        );
                    })}
                </div>

                {/* WP Backgrounds */}
                {layout.wpRegions.map((region, idx) => (
                  <div
                    key={`shade-${idx}`}
                    className="absolute opacity-20 border border-white/20"
                    style={{
                      top: region.startRow * zoomY,
                      height: (region.endRow - region.startRow) * zoomY,
                      left: LEFT_PANE_WIDTH + (region.startTime * zoomX),
                      width: (region.endTime - region.startTime) * zoomX,
                      backgroundColor: region.wp.color,
                      zIndex: 1
                    }}
                  />
                ))}

                {/* Dependencies */}
                <div 
                    className="absolute top-0 left-0 w-full h-full pointer-events-none" 
                    style={{ left: LEFT_PANE_WIDTH }}
                >
                     <DependencyLines 
                        dependencies={data.dependencies}
                        nodePositions={layout.nodePositions}
                        cellWidth={zoomX}
                        rowHeight={zoomY}
                        // milestoneOffset removed, passing 0
                        milestoneOffset={0}
                    />
                </div>

                {/* Optional integrated team legend. It is hidden for the ISCRA proposal Gantt unless member lines are added. */}
                {data.teamInfo.length > 0 && (
                    <div 
                        className="absolute z-30 bg-white/95 p-3 rounded-lg shadow-sm border border-gray-200 text-xs text-gray-600 backdrop-blur-sm"
                        style={{ 
                            top: legendTop,
                            left: LEFT_PANE_WIDTH + legendX,
                            width: Math.max(260, 5 * zoomX),
                        }}
                    >
                        <div className="flex flex-col gap-y-1">
                            {data.teamInfo.map((info, idx) => (
                                <div key={idx}>
                                    <strong className="text-gray-900">{info.id}: {info.role}</strong> - {info.topic}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Data Rows */}
                {layout.rows.map((rowItem, idx) => {
                  const top = rowItem.row * zoomY;
                  
                  // Left Pane Content
                  let labelContent = null;
                  let rowBackground = 'bg-white';
                  let leftPaneStyle = {};

                  if (rowItem.type === 'wp_header') {
                      rowBackground = 'bg-gray-50';
                      // WP Header spans the whole left pane
                      labelContent = (
                          <div className="flex items-center font-bold text-gray-800 text-sm px-4 h-full">
                             <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: rowItem.data.color }} />
                             <span className="mr-2 text-gray-500 font-mono text-xs">{rowItem.data.id}:</span>
                             {rowItem.data.label}
                          </div>
                      );
                  } else if (rowItem.type === 'task') {
                      leftPaneStyle = { backgroundColor: hexToRgba(rowItem.data.color, 0.15) };
                      labelContent = (
                        <div className="flex h-full w-full">
                            <div style={{ width: data.taskColumnWidth }} className={`flex items-center pl-1 text-sm text-gray-900 ${viewMode === 'matrix' ? 'border-r border-gray-200/50' : ''}`}>
                                <span className="w-12 mr-1 text-gray-600 font-mono text-[10px] text-left font-bold flex-shrink-0">{rowItem.data.id}</span>
                                <span className="truncate flex-1">{rowItem.data.label}</span>
                            </div>
                            {viewMode === 'matrix' && data.teamMembers.map(member => {
                                const isAssigned = rowItem.data.team && rowItem.data.team.includes(member);
                                return (
                                    <div 
                                        key={member} 
                                        style={{ width: MEMBER_COL_WIDTH }} 
                                        className="border-r border-gray-200/50 h-full flex items-center justify-center"
                                    >
                                        {isAssigned && (
                                            <Check size={14} className="text-gray-800 stroke-[3]" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                      );
                  } else if (rowItem.type === 'empty_ms') {
                      labelContent = (
                        <div className="flex items-center pl-4 text-sm font-medium text-gray-700 italic h-full">
                             <span className="mr-2 text-gray-400 font-mono text-xs">{rowItem.msData.id}:</span>
                             {rowItem.msData.label}
                        </div>
                      );
                  }

                  // Chart Bar
                  let barContent = null;
                  if (rowItem.type === 'task') {
                      const width = (rowItem.data.end - rowItem.data.start) * zoomX;
                      const left = (rowItem.data.start * zoomX);
                      const slack = rowItem.msData.slack || 0;
                      const displayWidth = Math.max(2, width - slack);

                      barContent = (
                          <div 
                            className="absolute h-3/5 top-[20%] rounded shadow-sm hover:shadow-md transition-all cursor-pointer border border-black/10 group flex items-center"
                            style={{ 
                                left: left, 
                                width: displayWidth, 
                                backgroundColor: rowItem.data.color 
                            }}
                            title={`Task: ${rowItem.data.label}\nDuration: M${rowItem.data.start+1} - M${rowItem.data.end}`}
                          >
                            {viewMode === 'inline' && rowItem.data.team && rowItem.data.team.length > 0 && (
                                <span className="px-2 text-[10px] font-bold text-white drop-shadow-md truncate w-full text-left opacity-90">
                                    {rowItem.data.team.join(', ')}
                                </span>
                            )}
                          </div>
                      );
                  }

                  // MS Marker
                  if (rowItem.type === 'ms_marker') {
                      const left = (rowItem.data.month * zoomX) + milestoneOffset;
                      
                      let alignLeft = false;
                      if (rowItem.data.alignment === 'left') alignLeft = true;
                      else if (rowItem.data.alignment === 'right') alignLeft = false;
                      else {
                          alignLeft = rowItem.data.month > (data.maxTime - 5);
                      }
                      
                      return (
                          <div 
                            key={`ms-${idx}`}
                            className="absolute pointer-events-none z-20"
                            style={{ 
                                top: top + (zoomY/2),
                                left: LEFT_PANE_WIDTH + left,
                            }}
                          >
                             <div 
                                className="absolute w-4 h-4 transform -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-white shadow-md z-30"
                                style={{ backgroundColor: rowItem.data.color }}
                             />
                             <div 
                                className="absolute top-1/2 transform -translate-y-1/2 flex flex-col bg-white/80 px-1 rounded backdrop-blur-sm z-20"
                                style={{
                                    [alignLeft ? 'right' : 'left']: alignLeft 
                                        ? (12 + (rowItem.data.labelOffset || 0)) + 'px' 
                                        : '12px',
                                    [alignLeft ? 'alignItems' : 'alignItems']: alignLeft ? 'flex-end' : 'flex-start'
                                }}
                             >
                                <span className="text-[10px] font-bold text-gray-500 leading-none">{rowItem.data.id}</span>
                                <span 
                                    className="text-xs font-bold whitespace-nowrap leading-tight"
                                    style={{ color: rowItem.data.color }}
                                >
                                    {rowItem.data.label}
                                </span>
                             </div>
                          </div>
                      );
                  }

                  return (
                    <div 
                        key={idx} 
                        className={`flex border-b border-gray-100 hover:bg-gray-50/50 ${rowBackground}`}
                        style={{ height: zoomY }}
                    >
                        <div 
                            className="sticky left-0 z-20 flex-shrink-0 border-r border-gray-200 overflow-hidden bg-white/50"
                            style={{ width: LEFT_PANE_WIDTH, ...leftPaneStyle }}
                        >
                            {labelContent}
                        </div>
                        
                        <div className="relative flex-1">
                            {barContent}
                        </div>
                    </div>
                  );
                })}

             </div>
          </div>
      </div>

      {/* Editor Pane */}
      <div className="no-print border-t border-gray-300 bg-white flex flex-col shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]" style={{ height: editorHeight }}>
        <div 
            className="h-2 bg-gray-100 border-b border-gray-200 cursor-row-resize flex justify-center items-center hover:bg-gray-200 transition-colors"
            onMouseDown={(e) => {
                const startY = e.clientY;
                const startHeight = editorHeight;
                const handleMouseMove = (moveEvent) => {
                    const newHeight = startHeight - (moveEvent.clientY - startY);
                    setEditorHeight(Math.max(100, Math.min(window.innerHeight - 200, newHeight)));
                };
                const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                };
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            }}
        >
            <div className="w-12 h-1 bg-gray-300 rounded-full"></div>
        </div>
        <div className="flex justify-between items-center px-4 py-2 bg-gray-50 border-b border-gray-200">
            <span className="text-xs font-bold text-gray-500 uppercase">Input Code</span>
            <div className="flex space-x-2">
                 <button onClick={() => setEditorHeight(prev => prev === 300 ? 50 : 300)} className="text-gray-500 hover:text-indigo-600">
                    {editorHeight > 100 ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                 </button>
            </div>
        </div>
        <div className="flex-1 relative">
            <textarea
              className="w-full h-full p-4 font-mono text-sm resize-none focus:outline-none bg-slate-900 text-slate-100 leading-relaxed"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
            />
             {data.errors.length > 0 && (
                <div className="absolute bottom-0 left-0 right-0 max-h-32 bg-red-50/95 border-t border-red-200 p-3 overflow-y-auto backdrop-blur-sm">
                <div className="flex items-center space-x-2 text-red-700 font-semibold mb-1 text-xs">
                    <AlertCircle size={12} />
                    <span>Syntax Errors</span>
                </div>
                <ul className="list-disc list-inside text-xs text-red-600 space-y-1">
                    {data.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                    ))}
                </ul>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
