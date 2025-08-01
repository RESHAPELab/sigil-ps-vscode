# Installing the SIGIL-PS VS Code Extension (.vsix)

**IMPORTANT:** This extension used to be called Tiamat. If you have downloaded a new version since the name change, ensure you uninstall the Tiamat version, as it is treated like two separate extensions.

This guide explains how to manually install the SIGIL-PS VS Code extension for testing, either using the **command line** or the **VS Code UI**.

---

## Obtain the `.vsix` File

Download and save the `.vsix` file to a known location (e.g., `Downloads`).

---

## Install the Extension

### **Method 1: Install via Command Line** (Recommended)

1. Open **VS Code**.
2. Open the **terminal**:
   - On Windows: `Ctrl + ~` or `View > Terminal`
   - On Mac: `Cmd + ~`
   - On Linux: `Ctrl + ~`
3. Run the following command, replacing `<path-to-file>` with the actual file location:
   ```sh
   code --install-extension <path-to-file>
   ```
   **Example:** If the `.vsix` file is in your `Downloads` folder:
   ```sh
   code --install-extension ~/Downloads/sigil-ps-0.0.3.vsix
   ```
4. Wait for VS Code to install the extension. You should see a success message.

### **Method 2: Install via VS Code UI**

1. Open **VS Code**.
2. Go to the **Extensions** view (`Ctrl + Shift + X`).
3. Click the `...` (More Actions) button in the top-right.
4. Select **"Install from VSIX..."**.
5. Navigate to and select the `.vsix` file.
6. Wait for VS Code to install the extension.

---

## Verify Installation

After installation, verify that the extension is installed:

- Open the **Extensions** view (`Ctrl + Shift + X`), and check if **SIGIL-PS** appears under "Installed Extensions".
- Alternatively, run the following command in the **Command Palette** (`Ctrl + Shift + P`):
  ```sh
  > Developer: Show Running Extensions
  ```
  Ensure that **SIGIL-PS** is listed, and the status says something like "Activation: 17ms"

---

## Updating the Extension

If you receive an updated version of the `.vsix` file:

- **Reinstall it** using the same installation steps.
- VS Code will replace the old version with the new one.