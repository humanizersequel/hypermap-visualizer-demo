// components/NamespaceGraph.js
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  MiniMap,
  Controls,
  Background,
} from 'reactflow';
import 'reactflow/dist/style.css'; // Import styles

// Custom node styles
const nodeStyle = {
  background: '#f2f2f2',
  color: '#333',
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '10px',
  width: 'auto',
  minWidth: '150px',
  textAlign: 'center',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  fontSize: '12px',
};

// Root node has a different style to highlight it
const rootNodeStyle = {
  ...nodeStyle,
  background: '#e6f7ff',
  border: '1px solid #91d5ff',
  fontWeight: 'bold',
};

const NamespaceGraph = ({ namespaceData, onNodeClick }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Effect to transform namespaceData into nodes and edges
  useEffect(() => {
    if (!namespaceData || Object.keys(namespaceData).length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // First, identify the root node and build a tree structure
    const ROOT_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
    let rootNode = null;
    
    // Find all nodes and their children
    const nodeMap = {}; // Map of node ID to its data
    const childrenMap = {}; // Map of parent ID to array of child IDs
    const orphans = []; // Nodes without a parent in our data
    
    // First pass - collect all nodes and their parent-child relationships
    for (const hash in namespaceData) {
      if (Object.prototype.hasOwnProperty.call(namespaceData, hash)) {
        const entry = namespaceData[hash];
        
        // Store node data
        nodeMap[hash] = entry;
        
        // If this is the root node, mark it
        if (hash === ROOT_HASH) {
          rootNode = entry;
          continue;
        }
        
        // Add this node to its parent's children array
        const parentHash = entry.parentHash;
        if (!childrenMap[parentHash]) {
          childrenMap[parentHash] = [];
        }
        childrenMap[parentHash].push(hash);
        
        // If we don't have the parent in our data, this node is an orphan
        if (!namespaceData[parentHash]) {
          orphans.push(hash);
        }
      }
    }
    
    if (!rootNode) {
      console.error("Root node not found in data!");
      return;
    }

    // Function to get height of a subtree
    const getSubtreeHeight = (nodeId) => {
      const children = childrenMap[nodeId] || [];
      if (children.length === 0) return 1;
      
      let maxChildHeight = 0;
      for (const childId of children) {
        const childHeight = getSubtreeHeight(childId);
        maxChildHeight = Math.max(maxChildHeight, childHeight);
      }
      
      return 1 + maxChildHeight;
    };
    
    // Function to get width of a subtree
    const getSubtreeWidth = (nodeId) => {
      const children = childrenMap[nodeId] || [];
      if (children.length === 0) return 1;
      
      let totalWidth = 0;
      for (const childId of children) {
        totalWidth += getSubtreeWidth(childId);
      }
      
      return Math.max(1, totalWidth);
    };

    // Utility function to calculate position for each node
    const calculateNodePositions = () => {
      const LEVEL_HEIGHT = 150; // Vertical distance between levels
      const NODE_WIDTH = 180; // Approximate width of a node
      
      const positions = {};
      
      // Process each level of the tree, starting from root
      const processNode = (nodeId, level, offsetX, parentWidth) => {
        const children = childrenMap[nodeId] || [];
        const subtreeWidth = getSubtreeWidth(nodeId);
        
        // Calculate x position based on the subtree width and parent width
        let nodeX = offsetX + (parentWidth ? (parentWidth - subtreeWidth) / 2 * NODE_WIDTH : 0);
        
        if (children.length === 0) {
          // Leaf node gets positioned at the current offset
          positions[nodeId] = { x: nodeX, y: level * LEVEL_HEIGHT };
          return nodeX + NODE_WIDTH;
        }
        
        // For internal nodes, position all children first
        let childOffsetX = nodeX;
        for (const childId of children) {
          const childSubtreeWidth = getSubtreeWidth(childId);
          childOffsetX = processNode(childId, level + 1, childOffsetX, childSubtreeWidth);
        }
        
        // Position this node centered above its children
        const firstChildX = positions[children[0]].x;
        const lastChildX = positions[children[children.length - 1]].x;
        positions[nodeId] = { 
          x: firstChildX + (lastChildX - firstChildX) / 2, 
          y: level * LEVEL_HEIGHT 
        };
        
        return childOffsetX;
      };
      
      // Start processing from the root
      processNode(ROOT_HASH, 0, 0, getSubtreeWidth(ROOT_HASH));
      
      return positions;
    };

    // Calculate all node positions
    const positions = calculateNodePositions();
    
    // Create ReactFlow nodes
    const graphNodes = [];
    const graphEdges = [];
    
    // Add nodes with calculated positions
    for (const hash in nodeMap) {
      const entry = nodeMap[hash];
      const pos = positions[hash] || { x: 0, y: 0 }; // Fallback position
      
      // Create node with proper style based on whether it's the root
      graphNodes.push({
        id: hash,
        data: {
          label: entry.label || entry.fullName || hash.substring(0, 8),
          fullData: entry,
        },
        position: pos,
        style: hash === ROOT_HASH ? rootNodeStyle : nodeStyle,
      });
      
      // Create edges from parent to children
      if (entry.parentHash && entry.parentHash !== hash) { // Avoid self-loops
        graphEdges.push({
          id: `edge-${entry.parentHash}-${hash}`,
          source: entry.parentHash,
          target: hash,
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#999' },
        });
      }
    }
    
    console.log(`Generated ${graphNodes.length} nodes and ${graphEdges.length} edges.`);
    setNodes(graphNodes);
    setEdges(graphEdges);

  }, [namespaceData]); // Re-run effect when namespaceData changes

  // Handle node click - pass full entry data up
  const handleNodeClickInternal = useCallback((event, node) => {
    if (onNodeClick && node.data?.fullData) {
      onNodeClick(node.data.fullData);
    }
  }, [onNodeClick]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClickInternal}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={1.5}
        defaultZoom={0.8}
        attributionPosition="bottom-left"
        nodesDraggable={false}
      >
        <MiniMap 
          nodeStrokeColor={(n) => n.style?.border || '#ddd'}
          nodeColor={(n) => n.id === '0x0000000000000000000000000000000000000000000000000000000000000000' ? '#e6f7ff' : '#f2f2f2'}
          nodeBorderRadius={8}
        />
        <Controls />
        <Background color="#f8f8f8" gap={16} />
      </ReactFlow>
    </div>
  );
};

export default NamespaceGraph;